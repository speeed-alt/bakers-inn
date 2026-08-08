import { useMemo, useState } from 'react'
import { collection, limit, orderBy, query, where } from 'firebase/firestore'
import { db } from '../firebase.js'
import { useSnapshot } from '../lib/hooks.js'
import { addDays, businessDateOf, formatDate, formatTime } from '../lib/dates.js'
import { formatMoney } from '../lib/money.js'
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
import { Empty, Money } from '../components/ui.jsx'
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
  const order = useSnapshot(() => productionDoc(today), [today])
  const demands = useSnapshot(() => demandsForDate(today), [today])
  const reports = useSnapshot(
    () => query(collection(db, 'dailyReports'), orderBy('businessDate', 'desc'), limit(40)),
    [],
  )
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
        transfers: transfers.data ?? [],
        order: order.data,
        materials: materials.data ?? [],
        nameOf,
      }),
    [today, branchList, closings.data, transfers.data, order.data, materials.data],
  )

  const best = week.filter((d) => d.total > 0)
  const weekTotal = week.reduce((sum, d) => sum + d.total, 0)
  const tradingDays = best.length || 1

  return (
    <div className="page">
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
          <div className="stat">
            <div className="label">Card</div>
            <div className="value sub">{formatMoney(overall.cardTotal)}</div>
          </div>
          <div className="stat">
            <div className="label">Sales</div>
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

      <Faults rows={faults.data ?? []} today={today} nameOf={nameOf} />

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

      <div className="card">
        <h3>Last {DAYS_SHOWN} days</h3>
        <Week week={week} />
      </div>

      <Waste reports={reports.data ?? []} />

      <Margin
        week={week}
        reports={reports.data ?? []}
        purchases={purchases.data ?? []}
      />

      <Accountant today={today} />


      <div className="card">
        <h3>By outlet today</h3>
        <table>
          <tbody>
            {perBranch.map(({ branchId, summary }) => (
              <tr key={branchId}>
                <td>
                  <b>{nameOf(branchId)}</b>
                  <div className="muted small">
                    {summary.txCount} sales · cash <Money minor={summary.cashTotal} /> · card{' '}
                    <Money minor={summary.cardTotal} />
                    {summary.voidedCount > 0 && ` · ${summary.voidedCount} voided`}
                  </div>
                </td>
                <td className="num"><Money minor={summary.salesTotal} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {overall.byProduct.length > 0 && (
        <div className="card">
          <h3>Best sellers today</h3>
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
        </div>
      )}

      <div className="card">
        <h3>Recent closes</h3>
        {(closings.data ?? []).length === 0 && <Empty>No days closed yet.</Empty>}
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
      </div>
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
      detail: order ? order.ref : 'waiting for 5am',
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

function Margin({ week, reports, purchases }) {
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
  const { from, to } = monthRange(today)

  async function exportMonth() {
    setBusy(true)
    setDone(null)
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
      setDone('Could not build the export — check the connection and try again.')
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
    </div>
  )
}

function Waste({ reports }) {
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
          <div className="label">Thrown out</div>
          <div className={`value ${waste.wasteValue > 0 ? 'bad' : ''}`}>
            {formatMoney(waste.wasteValue)}
          </div>
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
                  <td className="num bad"><Money minor={w.value} /></td>
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

