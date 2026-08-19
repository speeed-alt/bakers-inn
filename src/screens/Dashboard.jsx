import { useMemo, useState } from 'react'
import { collection, limit, orderBy, query, where } from 'firebase/firestore'
import { db } from '../firebase.js'
import { useSnapshot } from '../lib/hooks.js'
import { addDays, businessDateOf, formatDate, formatTime, previousDate } from '../lib/dates.js'
import { formatMoney, parseMoney } from '../lib/money.js'
import { useAuth } from '../auth.jsx'
import { dailyRateProducts, ratesNotSet, ratesOf } from '../lib/rates.js'
import { rateDoc, saveRates } from '../data/rates.js'
import { summariseDay } from '../lib/report.js'
import { productionProgress, shortfalls } from '../lib/compile.js'
import { buildWeek, DAYS_SHOWN, findProblems, summariseWaste } from '../lib/dashboard.js'
import { reopenCount } from '../lib/closing.js'
import { productionDoc } from '../data/production.js'
import { demandsForDate } from '../data/demands.js'
import { materialsQuery, purchasesQuery } from '../data/materials.js'
import { recentErrorsQuery } from '../data/errors.js'
import { grossMargin } from '../lib/materials.js'
import { dailySummaryCsv, downloadCsv, monthRange, purchasesCsv, salesCsv } from '../lib/csv.js'
import { Empty, Loading, Money } from '../components/ui.jsx'
import DailySheet from '../components/DailySheet.jsx'
import PracticeCard from '../components/PracticeCard.jsx'
import { isPractising } from '../lib/practice.js'
import DailyRegister from '../components/DailyRegister.jsx'
import { buildRegister, recentDates } from '../lib/register.js'
import { Modal } from '../components/ui.jsx'
import { printSheet } from '../lib/paper.js'
import { dailySheet } from '../lib/dailySheet.js'
import { getDocs } from 'firebase/firestore'

/**
 * What the owner wants on his phone is not a pile of numbers — it is the answer
 * to two questions: how much did we take, and is anything wrong today. So the
 * takings come first, then the state of today's cycle, then a short list of
 * things that actually need him. Everything else is detail below the fold.
 */
export default function Dashboard() {
  const today = businessDateOf()

  const branches = useSnapshot(() => collection(db, 'branches'), [])
  const sales = useSnapshot(
    () => query(collection(db, 'sales'), where('businessDate', '==', today)),
    [today],
  )
  const closings = useSnapshot(
    () => query(collection(db, 'closings'), orderBy('businessDate', 'desc'), limit(30)),
    [],
  )
  // The owner may read every branch, so these need no branch filter — for
  // anyone else Firestore would refuse them. See firestore.rules.
  const transfers = useSnapshot(
    () => query(collection(db, 'transfers'), where('businessDate', '==', today)),
    [today],
  )
  // Yesterday's sales, so the "till is blocked" warning can be true rather than
  // assumed. Owner-only, and the same unfiltered shape as today's above.
  const yesterdaySales = useSnapshot(
    () => query(collection(db, 'sales'), where('businessDate', '==', previousDate(today))),
    [today],
  )
  const order = useSnapshot(() => productionDoc(today), [today])
  const demands = useSnapshot(() => demandsForDate(today), [today])
  const reports = useSnapshot(
    () => query(collection(db, 'dailyReports'), orderBy('businessDate', 'desc'), limit(40)),
    [],
  )
  const products = useSnapshot(() => collection(db, 'products'), [])
  const materials = useSnapshot(() => materialsQuery(), [])
  const purchases = useSnapshot(() => purchasesQuery(limit(60)), [])
  const faults = useSnapshot(() => recentErrorsQuery(20), [])

  const branchList = branches.data ?? []
  const nameOf = (id) => branchList.find((b) => b.id === id)?.name ?? id

  const all = sales.data ?? []
  const overall = useMemo(() => summariseDay(all), [all])

  const perBranch = useMemo(() => {
    const map = new Map(branchList.map((b) => [b.id, []]))
    for (const s of all) {
      if (!map.has(s.branchId)) map.set(s.branchId, [])
      map.get(s.branchId).push(s)
    }
    return [...map.entries()].map(([branchId, list]) => ({
      branchId,
      summary: summariseDay(list),
    }))
  }, [all, branchList])

  const week = useMemo(() => buildWeek(closings.data ?? [], today, overall.salesTotal), [
    closings.data,
    today,
    overall.salesTotal,
  ])

  const attention = useMemo(
    () =>
      findProblems({
        today,
        branches: branchList,
        closings: closings.data ?? [],
        yesterdaySales: yesterdaySales.data ?? [],
        transfers: transfers.data ?? [],
        order: order.data,
        materials: materials.data ?? [],
        // Everything ever bought, so a material sitting at zero because nobody
        // has entered it yet is not reported as an emergency.
        purchased: new Set(
          (purchases.data ?? []).flatMap((p) => (p.items ?? []).map((i) => i.materialId)),
        ),
        nameOf,
      }),
    [today, branchList, closings.data, yesterdaySales.data, transfers.data, order.data, materials.data, purchases.data],
  )

  const best = week.filter((d) => d.total > 0)
  const weekTotal = week.reduce((sum, d) => sum + d.total, 0)
  const tradingDays = best.length || 1

  // His own daily line. Every input is already on this screen, so it costs no
  // extra read — it was only ever the shape that was missing.
  // Only true while the printable register is open, which is what stops its
  // two extra queries running on every dashboard load.
  const [register, setRegister] = useState(false)

  const sheet = useMemo(
    () =>
      dailySheet({
        products: products.data ?? [],
        branches: branchList,
        production: order.data,
        transfers: transfers.data ?? [],
        sales: all,
        closings: closings.data ?? [],
        businessDate: today,
      }),
    [products.data, branchList, order.data, transfers.data, all, closings.data, today],
  )

  // Wait for the two feeds the figures are made of, and nothing else.
  //
  // Without this the whole page drew immediately with every total at Rs 0,
  // which is not a missing number — it is a wrong one, and it says the shops
  // took nothing today. The rest (materials, purchases, reports) only feed
  // panels below the fold, so holding the takings back for them would be the
  // slowest read deciding when the owner sees the one figure he opened this
  // for.
  if (sales.loading || branches.loading) {
    return (
      <div className="page">
        <div className="card">
          <Loading>Reading today's takings…</Loading>
        </div>
      </div>
    )
  }

  // A denied or failed read used to fall through the ?? [] / ?? 0 defaults
  // exactly like a quiet morning — Rs 0 takings looks identical whether
  // nothing sold or the read never landed. Said out loud instead.
  if (sales.error || branches.error) {
    return (
      <div className="page">
        <div className="card">
          <h2>Could not read today's figures</h2>
          <p className="muted">Check the connection and reload.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="page">
      {/* First, before anything the system invented. He opens this to find the
          line he would otherwise be writing by hand, and recognising it is what
          buys every screen underneath the benefit of the doubt. */}
      <DailySheet sheet={sheet} onPrint={() => setRegister(true)} />

      {/* Portalled to <body> and printed as a sheet, not a till roll. Printing
          collapses #root, so anything left in the app tree prints blank. */}
      {register && (
        <Modal onClose={() => setRegister(false)} wide>
          <RegisterSheet
            today={today}
            branches={branchList}
            products={products.data ?? []}
            todaySheet={sheet}
            onClose={() => setRegister(false)}
          />
        </Modal>
      )}

      <div className="card">
        <div className="row between" style={{ marginBottom: 12 }}>
          <h2 style={{ margin: 0 }}>Today</h2>
          <span className="muted small">{formatDate(today)}</span>
        </div>
        <div className="stats">
          <div className="stat">
            <div className="label">Takings</div>
            <div className="value">{formatMoney(overall.salesTotal)}</div>
          </div>
          <div className="stat">
            <div className="label">Cash</div>
            <div className="value sub">{formatMoney(overall.cashTotal)}</div>
          </div>
          {/* One tile per way anybody actually paid today. Cash sits beside
              them because it is the only one that should be in a drawer
              tonight — the rest are checked against statements. */}
          {overall.byMethod.filter((m) => !m.drawer).map((m) => (
            <div className="stat" key={m.id}>
              <div className="label">{m.label}</div>
              <div className="value sub">{formatMoney(m.total)}</div>
            </div>
          ))}
          <div className="stat">
            {/* Not "Sales": next to a column of rupee figures headed
                "Takings", the word read like another money stat rather than a
                count of transactions. */}
            <div className="label">Transactions</div>
            <div className="value sub">{overall.txCount}</div>
          </div>
          <div className="stat">
            <div className="label">Week so far</div>
            <div className="value sub">{formatMoney(weekTotal)}</div>
          </div>
          <div className="stat">
            <div className="label">Day average</div>
            <div className="value sub">{formatMoney(Math.round(weekTotal / tradingDays))}</div>
          </div>
        </div>
      </div>

      {attention.length > 0 && (
        <div className="card">
          <h3>Needs a look</h3>
          <div className="attention">
            {attention.map((item, i) => (
              <div className="attention-row" key={i}>
                {item.what}
                <div className="where">{item.where}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Cycle-state and the two exception cards sit together here, restoring
          the order this file's own top comment documents: takings, then the
          state of today's cycle, then what needs him. A price-entry form
          (TodaysRates) used to sit between "Needs a look" and "Tablets
          reporting trouble", splitting the two attention-style cards apart. */}
      <div className="card">
        <h3>Today's round</h3>
        <TodaysRound
          branches={branchList}
          demands={demands.data ?? []}
          order={order.data}
          transfers={transfers.data ?? []}
          nameOf={nameOf}
        />
      </div>

      <TodaysRates today={today} products={products.data ?? []} />

      <Faults rows={faults.data ?? []} today={today} nameOf={nameOf} />

      <div className="card">
        <h3>Last {DAYS_SHOWN} days</h3>
        <Week week={week} />
      </div>

      <Waste reports={reports.data ?? []} loading={reports.loading} />

      <Margin
        week={week}
        reports={reports.data ?? []}
        purchases={purchases.data ?? []}
        loading={reports.loading || purchases.loading}
      />

      <Accountant today={today} />


      <div className="card">
        <h3>By outlet today</h3>
        <table>
          <thead>
            <tr>
              <th>Outlet</th>
              <th className="num">Sales</th>
              <th className="num">Cash</th>
              <th className="num">Card</th>
              <th className="num">Total</th>
            </tr>
          </thead>
          <tbody>
            {perBranch.map(({ branchId, summary }) => (
              <tr key={branchId}>
                <td>
                  <b>{nameOf(branchId)}</b>
                  {summary.voidedCount > 0 && (
                    <div className="muted small">{summary.voidedCount} voided</div>
                  )}
                </td>
                <td className="num">{summary.txCount}</td>
                <td className="num muted"><Money minor={summary.cashTotal} /></td>
                <td className="num muted"><Money minor={summary.cardTotal} /></td>
                <td className="num"><b><Money minor={summary.salesTotal} /></b></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h3>Best sellers today</h3>
        {overall.byProduct.length === 0 ? (
          <Empty>Nothing rung up yet today.</Empty>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Product</th>
                <th className="num">Qty</th>
                <th className="num">Value</th>
              </tr>
            </thead>
            <tbody>
              {overall.byProduct.slice(0, 8).map((p) => (
                <tr key={p.productId}>
                  <td>{p.name}</td>
                  <td className="num">{p.qty}</td>
                  <td className="num"><Money minor={p.revenue} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h3>Recent closes</h3>
        {closings.loading ? (
          <Loading inline>Reading recent closes…</Loading>
        ) : (closings.data ?? []).length === 0 ? (
          <Empty>No days closed yet.</Empty>
        ) : (
        <div className="scroll-x">
          <table>
            <thead>
              <tr>
                <th>Day</th>
                <th>Outlet</th>
                <th className="num">Takings</th>
                <th className="num">Over / short</th>
              </tr>
            </thead>
            <tbody>
              {(closings.data ?? []).slice(0, 12).map((c) => {
                const reopens = reopenCount(c)
                return (
                  <tr key={c.id}>
                    <td>
                      {formatDate(c.businessDate)}
                      {c.status !== 'closed' && <span className="muted small"> · {c.status}</span>}
                      {reopens > 0 && (
                        <div className="muted small">
                          reopened {reopens}× · last by {c.reopenedByName}
                        </div>
                      )}
                    </td>
                    <td className="muted small">{nameOf(c.branchId)}</td>
                    <td className="num"><Money minor={c.salesTotal} /></td>
                    <td className={`num ${c.overShort === 0 ? 'muted' : 'bad'}`}>
                      {c.overShort === 0 ? '—' : <Money minor={c.overShort} />}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        )}
      </div>

      <OffCatalogue rows={overall.customItems} total={overall.customTotal} />

      {/* Last on the page on purpose. It is used the day somebody new starts
          and then not for months, and a switch that changes what every figure
          above it means should not sit where a thumb lands. */}
      <PracticeCard />
    </div>
  )
}

/**
 * Tablets that hit a fault recently.
 *
 * Only the last few days are shown, and the card disappears entirely when there
 * is nothing to say. That is deliberate: a fault report can never be edited or
 * deleted, so there is no way to tick one off, and a permanent list of old
 * crashes would train the owner to ignore the whole card — which is the one
 * outcome that would make this worse than not having it.
 *
 * The wording stays plain. He does not need the stack trace; he needs to know
 * which shop to ring.
 */
function Faults({ rows, today, nameOf }) {
  const since = addDays(today, -3)
  const recent = rows.filter((r) => (r.businessDate ?? '') >= since)
  if (recent.length === 0) return null

  return (
    <div className="card">
      <div className="row between">
        <h3 style={{ margin: 0 }}>Tablets reporting trouble</h3>
        <span className="muted small">last 3 days</span>
      </div>
      <div className="attention">
        {recent.slice(0, 6).map((r) => (
          <div className="attention-row" key={r.id}>
            {nameOf(r.branchId)} · till {r.device ?? '?'}
            <div className="where">
              {formatDate(r.businessDate)}
              {r.at?.toDate && ` at ${formatTime(r.at.toDate())}`} · {r.message}
            </div>
          </div>
        ))}
      </div>
      <p className="muted small" style={{ marginBottom: 0 }}>
        The tablet recovered on its own — no sales are lost. If the same outlet keeps appearing,
        that screen needs looking at.
      </p>
    </div>
  )
}

/**
 * This morning's rates for the things that are priced fresh.
 *
 * One card, all three outlets. The whole point of a rate is that it is decided
 * once and applies everywhere — an owner who has to set the egg price in three
 * places will eventually set it in two.
 *
 * The card disappears entirely when no product is flagged as daily-rate, so a
 * shop that prices nothing this way never sees it.
 */
function TodaysRates({ today, products }) {
  const { profile } = useAuth()
  const rates = useSnapshot(() => rateDoc(today), [today])
  const prices = ratesOf(rates.data)
  const items = dailyRateProducts(products)

  const [draft, setDraft] = useState(null)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)

  if (items.length === 0) return null

  // Rates are shared reference data, so `saveRates` writes to the live sheet
  // whatever mode the tablet is in — and the owner demonstrating "this is
  // where I set the egg rate" during a lesson would have set it, for real, at
  // every outlet. The one screen where a training tap moves a real price.
  if (isPractising()) {
    return (
      <div className="card">
        <h3>Today's rates</h3>
        <p className="muted small" style={{ margin: 0 }}>
          Not while this tablet is practising. Rates are the real ones every till sells at, so they
          are never changed from a training session. End practice to set them.
        </p>
      </div>
    )
  }
  if (rates.loading) {
    return <div className="card"><Loading inline>Reading today's rates…</Loading></div>
  }

  // Seeded from today's sheet where it exists, and from each product's last
  // known rate where it does not — so the owner is confirming yesterday's
  // figures rather than typing every one from nothing.
  const values =
    draft ??
    Object.fromEntries(
      items.map((p) => [
        p.id,
        formatMoney(Number.isFinite(prices[p.id]) ? prices[p.id] : p.price ?? 0, { symbol: false }),
      ]),
    )

  const missing = ratesNotSet(items, prices)
  const parsed = Object.fromEntries(
    Object.entries(values).map(([id, text]) => [id, parseMoney(text)]),
  )
  const valid = Object.values(parsed).every((v) => v !== null && v >= 0)

  async function save() {
    setBusy(true)
    setSaved(false)
    try {
      await saveRates({
        businessDate: today,
        prices: parsed,
        user: { id: profile.id, name: profile.name },
      })
      setDraft(null)
      setSaved(true)
    } catch (error) {
      console.error('[bakery] rates failed to save', error)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card">
      <div className="row between">
        <h3 style={{ margin: 0 }}>Today's rates</h3>
        <span className="muted small">
          {missing.length === 0 ? 'set for today' : `${missing.length} still to set`}
        </span>
      </div>
      <p className="muted small">
        The items whose price moves with what they cost this morning. Set here once and every till
        charges it. Sales already rung keep what they were rung at.
      </p>
      <div className="bill">
        {items.map((p) => (
          <div className="bill-row" key={p.id}>
            <span className="bill-code">{p.code}</span>
            <span>
              <span className="bill-name">{p.name}</span>
              {/* Folded in here rather than in the amount column: on the
                  mobile bill-row layout that column sits where every other
                  screen puts a money figure, and a status word there instead
                  of a rate reads as a mistake at a glance. */}
              <span className="muted small">
                {p.soldByWeight ? ` · per ${p.unit || 'kg'}` : ''}
                {' · '}
                {Number.isFinite(prices[p.id]) ? 'set for today' : 'last known'}
              </span>
            </span>
            <input
              type="text"
              inputMode="decimal"
              className="rate-input"
              aria-label={`rate for ${p.name}`}
              value={values[p.id] ?? ''}
              onChange={(e) => setDraft({ ...values, [p.id]: e.target.value })}
              onFocus={(e) => e.target.select()}
            />
          </div>
        ))}
      </div>
      <div className="row" style={{ marginTop: 12 }}>
        <button className="btn primary" disabled={!valid || busy} onClick={save}>
          {busy ? 'Saving…' : "Set today's rates"}
        </button>
        {saved && <span className="muted small">Saved — every till has it.</span>}
      </div>
    </div>
  )
}

function TodaysRound({ branches, demands, order, transfers, nameOf }) {
  const expected = branches.length || 3
  const ordersIn = demands.filter((d) => d.status !== 'draft').length
  const progress = productionProgress(order)
  const out = transfers.filter((t) => t.direction !== 'return')
  const sent = out.filter((t) => t.status !== 'draft')
  const received = out.filter((t) => t.status === 'received')
  const short = order ? shortfalls(order) : []

  const steps = [
    {
      done: ordersIn >= expected,
      what: 'Outlets ordered',
      detail: `${ordersIn} of ${expected}`,
    },
    {
      done: Boolean(order),
      what: 'Baking list made',
      detail: order ? order.ref : 'the kitchen has not made it yet',
    },
    {
      done: Boolean(order) && order.status === 'done',
      what: 'Baked',
      detail: order ? `${progress.made} of ${progress.needed}` : '—',
    },
    {
      done: out.length > 0 && sent.length === out.length,
      what: 'Delivered out',
      detail: out.length ? `${sent.length} of ${out.length}` : 'nothing to send',
    },
    {
      done: out.length > 0 && received.length === out.length,
      what: 'Confirmed by outlets',
      detail: out.length ? `${received.length} of ${out.length}` : '—',
    },
  ]

  return (
    <>
      <div className="steps">
        {steps.map((s) => (
          <div className={`step ${s.done ? 'done' : ''}`} key={s.what}>
            <span className="mark">{s.done ? '●' : '○'}</span>
            <span className="what">{s.what}</span>
            <span className="detail">{s.detail}</span>
          </div>
        ))}
      </div>
      {short.length > 0 && (
        <p className="muted small" style={{ marginBottom: 0 }}>
          Short today: {short.map((s) => `${s.productName} (${s.short})`).join(', ')}.
        </p>
      )}
      {order?.autoFilled?.length > 0 && (
        <p className="muted small" style={{ marginBottom: 0 }}>
          {order.autoFilled.map(nameOf).join(', ')} missed the cutoff — last week's order was used.
        </p>
      )}
    </>
  )
}

function Margin({ week, reports, purchases, loading }) {
  if (loading) {
    return <div className="card"><Loading inline>Working out gross margin…</Loading></div>
  }

  const from = week[0]?.date
  const to = week.at(-1)?.date
  const inWindow = (date) => date >= from && date <= to

  const salesTotal = week.reduce((sum, d) => sum + d.total, 0)
  const materialCost = purchases
    .filter((p) => inWindow(p.businessDate))
    .reduce((sum, p) => sum + (p.total ?? 0), 0)
  const wasted = reports
    .filter((r) => inWindow(r.businessDate))
    .reduce((sum, r) => sum + (r.wasteValue ?? 0), 0)

  const m = grossMargin({ salesTotal, materialCost, wasteValue: wasted })

  return (
    <div className="card">
      <div className="row between">
        <h3 style={{ margin: 0 }}>Gross margin</h3>
        <span className="muted small">last {week.length} days, whole business</span>
      </div>
      <table>
        <tbody>
          <tr><td>Takings</td><td className="num"><Money minor={m.salesTotal} /></td></tr>
          <tr><td>Less materials bought</td><td className="num">−<Money minor={m.materialCost} /></td></tr>
          <tr><td>Less thrown out</td><td className="num">−<Money minor={m.wasteValue} /></td></tr>
          <tr>
            <td><b>Gross margin</b></td>
            <td className={`num ${m.margin < 0 ? 'bad' : ''}`}>
              <b><Money minor={m.margin} />{m.marginPct !== null && ` · ${m.marginPct}%`}</b>
            </td>
          </tr>
        </tbody>
      </table>
      <p className="muted small" style={{ marginBottom: 0 }}>
        For the business as a whole, not per outlet — without recipes there is no honest way to say
        what one shop's stock cost, and a made-up figure would be worse than none. Materials are
        counted when bought, not when used, so a big delivery makes one week look worse and the
        next look better.
      </p>
    </div>
  )
}

function Accountant({ today }) {
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(null)
  const [failed, setFailed] = useState(false)
  const { from, to } = monthRange(today)

  async function exportMonth() {
    setBusy(true)
    setDone(null)
    setFailed(false)
    try {
      const between = (field) => [
        where(field, '>=', from),
        where(field, '<=', to),
      ]
      const [sales, purchases, reports] = await Promise.all([
        getDocs(query(collection(db, 'sales'), ...between('businessDate'))),
        getDocs(query(collection(db, 'purchases'), ...between('businessDate'))),
        getDocs(query(collection(db, 'dailyReports'), ...between('businessDate'))),
      ])
      const month = from.slice(0, 7)
      downloadCsv(`sales-${month}.csv`, salesCsv(sales.docs.map((d) => d.data())))
      downloadCsv(`purchases-${month}.csv`, purchasesCsv(purchases.docs.map((d) => d.data())))
      downloadCsv(`daily-summary-${month}.csv`, dailySummaryCsv(reports.docs.map((d) => d.data())))
      setDone(`${sales.size} sales, ${purchases.size} purchases, ${reports.size} days`)
    } catch (error) {
      console.error('[bakery] export failed', error)
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card">
      <h3>For the accountant</h3>
      <p className="muted small">
        Three files for {from.slice(0, 7)} — every sale, every purchase, and a line per outlet per
        day. They open in any spreadsheet, so nothing has to be typed again.
      </p>
      <button className="btn" disabled={busy} onClick={exportMonth}>
        {busy ? 'Building…' : 'Download this month'}
      </button>
      {done && <p className="muted small" style={{ marginBottom: 0 }}>{done}</p>}
      {failed && (
        // Distinct from the success message, not by colour but by weight —
        // the same reasoning as the claims-stale banner: this one needs to be
        // noticed, not just read.
        <p className="small" style={{ marginBottom: 0, fontWeight: 600 }}>
          Export failed — check the connection and try again.
        </p>
      )}
    </div>
  )
}

function Waste({ reports, loading }) {
  if (loading) {
    return <div className="card"><Loading inline>Reading waste and sell-through…</Loading></div>
  }

  // Every report here is a finished day — one is only written when an outlet
  // closes — so today's counts as soon as the first shop shuts, which is
  // exactly when the owner wants to see what went in the bin.
  const recent = reports.slice(0, 21)
  const waste = summariseWaste(recent)

  if (recent.length === 0) {
    return (
      <div className="card">
        <h3>Waste</h3>
        <Empty>
          Nothing yet. Waste figures appear once outlets have counted their leftovers at closing.
        </Empty>
      </div>
    )
  }

  const dayCount = new Set(recent.map((r) => r.businessDate)).size

  return (
    <div className="card">
      <div className="row between">
        <h3 style={{ margin: 0 }}>Waste and sell-through</h3>
        <span className="muted small">last {dayCount} day{dayCount > 1 ? 's' : ''} closed</span>
      </div>

      <div className="stats" style={{ margin: '12px 0' }}>
        <div className="stat">
          {/* Plain, not --alert: expected, budgeted-for waste is not the same
              fact as money that does not reconcile, which is what that colour
              is reserved for. */}
          <div className="label">Thrown out</div>
          <div className="value">{formatMoney(waste.wasteValue)}</div>
        </div>
        <div className="stat">
          <div className="label">Waste rate</div>
          <div className="value sub">{waste.wastePct}%</div>
        </div>
        <div className="stat">
          <div className="label">Sell-through</div>
          <div className="value sub">
            {waste.sellThroughPct === null ? '—' : `${waste.sellThroughPct}%`}
          </div>
        </div>
        <div className="stat">
          <div className="label">Lost in transit</div>
          <div className="value sub">{formatMoney(waste.varianceValue)}</div>
        </div>
      </div>

      {waste.worst.length > 0 && (
        <>
          <h3>Costing the most</h3>
          <table>
            <thead>
              <tr>
                <th>Product</th>
                <th className="num">Binned</th>
                <th className="num">Value</th>
              </tr>
            </thead>
            <tbody>
              {waste.worst.slice(0, 6).map((w) => (
                <tr key={w.productId}>
                  <td>{w.productName}</td>
                  <td className="num">{w.qty}</td>
                  <td className="num"><Money minor={w.value} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted small" style={{ marginBottom: 0 }}>
            Sell-through near 100% can mean selling out early — worth baking more, not less.
          </p>
        </>
      )}
    </div>
  )
}

/**
 * What was sold today that the bakery does not make.
 *
 * Cashiers can ring something that is not on the list — a bottle of Coke out of
 * the fridge — by typing a name and a price. That money is in the takings and
 * in the drawer, but it is deliberately kept out of the product figures, the
 * stock report and the baking list, because none of those know anything about
 * a Coke. Which means that without this card it would be spent, banked and
 * completely invisible.
 *
 * Two things it answers. Should this be a real product? — anything appearing
 * here week after week should be in the catalogue at a price the owner set,
 * not typed fresh by whoever is on the till. And is the price right? — this is
 * the only figure in the system nobody has checked, so it is worth a glance.
 *
 * Hidden entirely on a day with none, which is most days.
 */
function OffCatalogue({ rows = [], total = 0 }) {
  if (rows.length === 0) return null

  return (
    <div className="card">
      <h3>Sold off the list today</h3>
      <p className="muted small">
        Typed in at a till rather than picked from the catalogue. The money is in today's takings;
        the kitchen is never asked to bake these.
      </p>
      <div className="scroll-x">
        <table>
          <thead>
            <tr>
              <th>Item</th>
              <th className="num">Qty</th>
              <th className="num">Taken</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.productId}>
                <td>{r.name}</td>
                <td className="num">{r.qty}</td>
                <td className="num"><Money minor={r.revenue} /></td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td><b>Total</b></td>
              <td className="num">{rows.reduce((s, r) => s + r.qty, 0)}</td>
              <td className="num"><b><Money minor={total} /></b></td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="muted small" style={{ marginBottom: 0 }}>
        Anything here most days belongs in the catalogue, with a price you set — add it under{' '}
        <b>Catalogue</b> and the cashier picks it instead of typing it.
      </p>
    </div>
  )
}

/**
 * The register, loaded only when somebody asks to print it.
 *
 * Its two extra queries — the bake and the deliveries for the fortnight — are
 * not worth making on every dashboard load for a button most days nobody
 * presses. The closes are already on the screen and carry each day's takings
 * and waste, so nothing here re-reads a fortnight of individual sales.
 */
function RegisterSheet({ today, branches, products, todaySheet, onClose }) {
  const dates = useMemo(() => recentDates(today, 14), [today])

  // `in` takes up to 30 values, and 14 dates is well inside that — so this is
  // two document reads' worth of query rather than a range and an index.
  const productions = useSnapshot(
    () => query(collection(db, 'productionOrders'), where('businessDate', 'in', dates)),
    [dates.join()],
  )
  const transfers = useSnapshot(
    () => query(collection(db, 'transfers'), where('businessDate', 'in', dates)),
    [dates.join()],
  )
  // Its own closings, over exactly the dates it prints.
  //
  // It used to borrow the dashboard's list, which is `limit(30)` — sized for a
  // seven-day strip and a dozen recent closes. Three outlets closing nightly
  // make 42 documents over a fortnight, so the oldest four days arrived with
  // no closings at all and printed a full Production and Distribution figure
  // beside a blank Sale and blank Stale. The sheet has a "Checked by" line at
  // the foot: the owner was signing off a fortnight whose last four days were
  // quietly missing their takings.
  const closings = useSnapshot(
    () => query(collection(db, 'closings'), where('businessDate', 'in', dates)),
    [dates.join()],
  )

  if (productions.loading || transfers.loading || closings.loading) {
    return <Loading>Reading the last fortnight…</Loading>
  }

  const register = buildRegister({
    dates,
    branches,
    products,
    closings: closings.data ?? [],
    productions: productions.data ?? [],
    transfers: transfers.data ?? [],
    today,
    todaySheet,
  })

  return (
    <>
      <DailyRegister register={register} from={dates[dates.length - 1]} to={dates[0]} />
      <div className="grid2 no-print" style={{ marginTop: 16 }}>
        <button className="btn" onClick={() => printSheet({ landscape: true })}>Print</button>
        <button className="btn primary" onClick={onClose}>Done</button>
      </div>
    </>
  )
}

function Week({ week }) {
  const peak = Math.max(1, ...week.map((d) => d.total))
  return (
    <div className="bars">
      {week.map((d) => (
        <div className={`bar-row ${d.isToday ? 'today' : ''}`} key={d.date}>
          <span className="day">{d.isToday ? 'Today' : formatDate(d.date).replace(/,.*/, '')}</span>
          <span className="bar-track">
            <span className="bar-fill" style={{ width: `${Math.round((d.total / peak) * 100)}%` }} />
          </span>
          <span className="amount">{d.total ? formatMoney(d.total, { symbol: false }) : '—'}</span>
        </div>
      ))}
    </div>
  )
}

