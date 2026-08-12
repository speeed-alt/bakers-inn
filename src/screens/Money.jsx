import { useMemo, useState } from 'react'
import { collection } from 'firebase/firestore'
import { db } from '../firebase.js'
import { useSnapshot } from '../lib/hooks.js'
import { useAuth } from '../auth.jsx'
import { businessDateOf } from '../lib/dates.js'
import { formatMoney, parseMoney } from '../lib/money.js'
import { buildPnl, monthOf, monthsWithData, projectMonth, salarySheet } from '../lib/pnl.js'
import { expensesQuery, saveSalary, saveUtility } from '../data/expenses.js'
import { purchasesQuery } from '../data/materials.js'
import { UTILITY_CATEGORIES } from '../config.js'
import { Empty, Loading, Money } from '../components/ui.jsx'

/**
 * What the business actually made, once the bills and the wages are in.
 *
 * Two figures, and the screen is explicit about which is which. Per outlet it
 * stops short of ingredients, because flour is bought once at the hub and there
 * is no honest way to say what one shop's share of a sack was — see lib/pnl.js.
 * Only the whole-business figure is a profit.
 */
export default function MoneyScreen() {
  const { profile } = useAuth()
  const thisMonth = monthOf(businessDateOf())
  const [month, setMonth] = useState(thisMonth)

  const branches = useSnapshot(() => collection(db, 'branches'), [])
  const staff = useSnapshot(() => collection(db, 'users'), [])
  const reports = useSnapshot(() => collection(db, 'dailyReports'), [])
  const purchases = useSnapshot(() => purchasesQuery(), [])
  const expenses = useSnapshot(() => expensesQuery(), [])

  const loading = branches.loading || reports.loading || expenses.loading

  const months = useMemo(() => {
    const found = monthsWithData({
      reports: reports.data ?? [],
      purchases: purchases.data ?? [],
      expenses: expenses.data ?? [],
    })
    // This month always appears, even before anything has happened in it.
    return found.includes(thisMonth) ? found : [thisMonth, ...found]
  }, [reports.data, purchases.data, expenses.data, thisMonth])

  const pnl = useMemo(
    () =>
      buildPnl({
        month,
        branches: branches.data ?? [],
        reports: reports.data ?? [],
        purchases: purchases.data ?? [],
        expenses: expenses.data ?? [],
      }),
    [month, branches.data, reports.data, purchases.data, expenses.data],
  )

  const sheet = useMemo(
    () =>
      salarySheet({
        month,
        staff: staff.data ?? [],
        expenses: expenses.data ?? [],
        branches: branches.data ?? [],
      }),
    [month, staff.data, expenses.data, branches.data],
  )

  if (loading) {
    return (
      <div className="page">
        <div className="card"><Loading>Adding up the month…</Loading></div>
      </div>
    )
  }

  const b = pnl.business
  const projected = projectMonth(b, pnl)

  return (
    <div className="page">
      <div className="card">
        <div className="row between">
          <h2 style={{ margin: 0 }}>Profit and loss</h2>
          <select value={month} onChange={(e) => setMonth(e.target.value)} style={{ width: 'auto' }}>
            {months.map((m) => (
              <option key={m} value={m}>
                {monthName(m)}
              </option>
            ))}
          </select>
        </div>

        <table style={{ marginTop: 8 }}>
          <tbody>
            <tr>
              <td>Takings</td>
              <td className="num"><Money minor={b.takings} /></td>
            </tr>
            <tr>
              <td>Less ingredients bought</td>
              <td className="num">−<Money minor={b.materials} /></td>
            </tr>
            <tr>
              <td>Less thrown out</td>
              <td className="num">−<Money minor={b.waste} /></td>
            </tr>
            <tr>
              <td>Less wages</td>
              <td className="num">−<Money minor={b.salaries} /></td>
            </tr>
            <tr>
              <td>Less bills</td>
              <td className="num">−<Money minor={b.utilities} /></td>
            </tr>
            <tr>
              <td><b>Profit</b></td>
              <td className={`num ${b.profit < 0 ? 'bad' : ''}`}>
                <b>
                  <Money minor={b.profit} />
                  {b.marginPct !== null && ` · ${b.marginPct}%`}
                </b>
              </td>
            </tr>
          </tbody>
        </table>

        {projected && (
          <>
            <div className="row between" style={{ marginTop: 14 }}>
              <h3 style={{ margin: 0 }}>On course for</h3>
              <span className="muted small">
                {pnl.daysTrading} of {pnl.days} days so far
              </span>
            </div>
            <table>
              <tbody>
                <tr>
                  <td>Takings at this rate</td>
                  <td className="num"><Money minor={projected.takings} /></td>
                </tr>
                <tr>
                  <td><b>Profit at this rate</b></td>
                  <td className={`num ${projected.profit < 0 ? 'bad' : ''}`}>
                    <b>
                      <Money minor={projected.profit} />
                      {projected.marginPct !== null && ` · ${projected.marginPct}%`}
                    </b>
                  </td>
                </tr>
              </tbody>
            </table>
            <p className="muted small">
              The month is {pnl.daysTrading} days old, but wages and bills are the whole month's —
              so the figure above it will look bad until the month catches up. This is the same
              month scaled to {pnl.days} days at the rate it has gone so far. It is an estimate, not
              a record.
            </p>
          </>
        )}

        <p className="muted small" style={{ marginBottom: 0 }}>
          Ingredients are counted when bought, not when used, so a big delivery makes one month look
          worse and the next look better. Takings and waste come from the outlets' own closing
          reports, so this agrees with what each shop saw at the end of its day.
        </p>
      </div>

      <div className="card">
        <div className="row between">
          <h3 style={{ margin: 0 }}>By outlet</h3>
          <span className="muted small">before ingredients</span>
        </div>
        {pnl.perBranch.length === 0 ? (
          <Empty>No outlets to show yet.</Empty>
        ) : (
          <div className="scroll-x">
            <table>
              <thead>
                <tr>
                  <th>Outlet</th>
                  <th className="num">Takings</th>
                  <th className="num">Binned</th>
                  <th className="num">Wages</th>
                  <th className="num">Bills</th>
                  <th className="num">Left over</th>
                </tr>
              </thead>
              <tbody>
                {pnl.perBranch.map((row) => (
                  <tr key={row.branchId}>
                    <td>
                      {row.branchName}
                      <div className="muted small">{row.days} day{row.days === 1 ? '' : 's'} closed</div>
                    </td>
                    <td className="num"><Money minor={row.takings} /></td>
                    <td className="num muted">−<Money minor={row.waste} /></td>
                    <td className="num muted">−<Money minor={row.salaries} /></td>
                    <td className="num muted">−<Money minor={row.utilities} /></td>
                    <td className={`num ${row.contribution < 0 ? 'bad' : ''}`}>
                      <b><Money minor={row.contribution} /></b>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="muted small" style={{ marginBottom: 0 }}>
          <b>Not profit.</b> Ingredients are missing from these — flour is bought once at the hub and
          baked into bread for all three shops, and without recipes there is no honest way to say
          what one shop's share of a sack was. Splitting it by takings would give a per-shop figure
          that looks authoritative and is invented, and a shop could be closed on the strength of it.
          {b.sharedSalaries + b.sharedUtilities > 0 && (
            <>
              {' '}
              A further <Money minor={b.sharedSalaries + b.sharedUtilities} /> of wages and bills
              belongs to no single outlet and sits in the figure above.
            </>
          )}
        </p>
      </div>

      <Utilities
        month={month}
        branches={branches.data ?? []}
        expenses={expenses.data ?? []}
        user={profile}
      />

      <Salaries month={month} sheet={sheet} staff={staff.data ?? []} user={profile} />
    </div>
  )
}

function monthName(month) {
  const [year, m] = String(month).split('-')
  const date = new Date(Number(year), Number(m) - 1, 1)
  return date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
}

/** Bills: electricity, gas, rent. One per outlet per category per month. */
function Utilities({ month, branches, expenses, user }) {
  const [category, setCategory] = useState(UTILITY_CATEGORIES[0])
  const [branchId, setBranchId] = useState('')
  const [amount, setAmount] = useState('')
  const [busy, setBusy] = useState(false)

  const mine = expenses
    .filter((e) => e.type !== 'salary' && e.month === month)
    .sort((a, b) => String(a.category).localeCompare(String(b.category)))

  const total = mine.reduce((sum, e) => sum + (e.amount ?? 0), 0)
  const minor = parseMoney(amount)
  const valid = minor !== null && minor >= 0

  const nameOf = (id) => branches.find((x) => x.id === id)?.name ?? 'Whole business'

  async function save() {
    setBusy(true)
    try {
      await saveUtility({ month, branchId, category, amount: minor, user })
      setAmount('')
    } catch (error) {
      console.error('[bakery] bill failed to save', error)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card">
      <div className="row between">
        <h3 style={{ margin: 0 }}>Bills</h3>
        <span className="muted small">{formatMoney(total)} in {monthName(month)}</span>
      </div>

      {mine.length === 0 ? (
        <Empty>No bills entered for this month yet.</Empty>
      ) : (
        // .bill/.bill-row, matching the Wages block directly below — the two
        // lists are the same shape (a name, a note, an amount) and used to be
        // built from two different components.
        <div className="bill">
          {mine.map((e) => (
            <div className="bill-row" key={e.id}>
              <span className="bill-code" />
              <span>
                <span className="bill-name">{e.category}</span>
                <div className="muted small">{nameOf(e.branchId)}</div>
              </span>
              <span />
              <span className="bill-amount"><Money minor={e.amount} /></span>
            </div>
          ))}
        </div>
      )}

      <div className="row wrap" style={{ gap: 8, marginTop: 12 }}>
        <select value={category} onChange={(e) => setCategory(e.target.value)} style={{ width: 'auto', flex: 1, minWidth: 130 }}>
          {UTILITY_CATEGORIES.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <select value={branchId} onChange={(e) => setBranchId(e.target.value)} style={{ width: 'auto', flex: 1, minWidth: 130 }}>
          <option value="">Whole business</option>
          {branches.map((b) => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </select>
        <input
          type="text"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="Amount"
          aria-label="Bill amount"
          style={{ width: 120 }}
        />
        <button className="btn primary" disabled={!valid || busy} onClick={save}>
          {busy ? 'Saving…' : 'Save bill'}
        </button>
      </div>
      <p className="muted small" style={{ marginBottom: 0 }}>
        One bill per outlet per category per month. Entering the same one again corrects it rather
        than adding a second — nothing here is ever deleted.
      </p>
    </div>
  )
}

/** The month's wages, one line per person. */
function Salaries({ month, sheet, staff, user }) {
  const [draft, setDraft] = useState({})
  const [busy, setBusy] = useState(null)

  async function save(row) {
    const minor = parseMoney(draft[row.personId])
    if (minor === null || minor < 0) return
    setBusy(row.personId)
    try {
      const person = staff.find((s) => s.id === row.personId)
      await saveSalary({ month, person: { ...person, id: row.personId }, amount: minor, user })
      setDraft((c) => ({ ...c, [row.personId]: undefined }))
    } catch (error) {
      console.error('[bakery] salary failed to save', error)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="card">
      <div className="row between">
        <h3 style={{ margin: 0 }}>Wages</h3>
        <span className="muted small">
          {formatMoney(sheet.total)}
          {sheet.unset > 0 && ` · ${sheet.unset} not set`}
        </span>
      </div>

      {sheet.rows.length === 0 && <Empty>Nobody on the staff list yet.</Empty>}

      <div className="bill" style={{ marginTop: 8 }}>
        {sheet.rows.map((row) => {
          const shown = draft[row.personId] ?? (row.amount != null ? formatMoney(row.amount, { symbol: false }) : '')
          return (
            <div className="bill-row" key={row.personId}>
              <span className="bill-code">{row.set ? '' : '—'}</span>
              <span>
                <span className="bill-name">{row.name}</span>
                <div className="muted small">{row.role} · {row.branchName}</div>
              </span>
              <input
                type="text"
                inputMode="decimal"
                className="rate-input"
                aria-label={`wage for ${row.name}`}
                value={shown}
                onChange={(e) => setDraft((c) => ({ ...c, [row.personId]: e.target.value }))}
                onFocus={(e) => e.target.select()}
              />
              <span className="bill-amount">
                <button
                  className="btn ghost small"
                  disabled={busy === row.personId || draft[row.personId] === undefined}
                  onClick={() => save(row)}
                >
                  {busy === row.personId ? '…' : 'Save'}
                </button>
              </span>
            </div>
          )
        })}
      </div>

      <p className="muted small" style={{ marginBottom: 0 }}>
        Everybody appears, including anyone not yet paid — a sheet that quietly leaves out the
        person you forgot is worse than no sheet. One figure per person per month, so entering it
        again corrects it rather than paying them twice.
      </p>
    </div>
  )
}
