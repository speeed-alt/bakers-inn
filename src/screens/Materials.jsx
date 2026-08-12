import { useMemo, useState } from 'react'
import { collection, limit, orderBy, query } from 'firebase/firestore'
import { db } from '../firebase.js'
import { useSnapshot } from '../lib/hooks.js'
import { useAuth } from '../auth.jsx'
import { formatDate } from '../lib/dates.js'
import { formatMoney, parseMoney } from '../lib/money.js'
import { printSheet } from '../lib/paper.js'
import {
  daysOfStock,
  isLow,
  lowStock,
  purchaseTotal,
  stockValue,
  COUNT,
  MOVEMENTS,
  RECEIVED,
  SPOILAGE,
} from '../lib/materials.js'
import {
  archiveMaterial,
  materialsQuery,
  purchasesQuery,
  recordMovement,
  recordPurchase,
  saveMaterial,
} from '../data/materials.js'
import { Empty, Loading, Modal, Money } from '../components/ui.jsx'
import StockSheet from '../components/StockSheet.jsx'

/**
 * Raw materials: what is on the shelf, how fast it goes, and what has been
 * bought. Deliberately a ledger and not a recipe engine — the owner logs a
 * delivery, counts now and then, and notes anything that went bad. Everything
 * else is worked out from those three.
 */
export default function Materials() {
  const { profile } = useAuth()

  const materials = useSnapshot(() => materialsQuery(), [])
  const purchases = useSnapshot(() => purchasesQuery(limit(8)), [])
  const branches = useSnapshot(() => collection(db, 'branches'), [])
  const reports = useSnapshot(
    () => query(collection(db, 'dailyReports'), orderBy('businessDate', 'desc'), limit(20)),
    [],
  )

  const [buying, setBuying] = useState(false)
  const [moving, setMoving] = useState(null)
  const [editing, setEditing] = useState(null)
  const [sheet, setSheet] = useState(null)

  const list = useMemo(
    () => [...(materials.data ?? [])].sort((a, b) => a.name.localeCompare(b.name)),
    [materials.data],
  )
  const live = list.filter((m) => m.active !== false)
  const short = lowStock(live)

  if (materials.loading) {
    return <div className="page"><Loading>Loading raw materials…</Loading></div>
  }

  return (
    <div className="page">
      <div className="card">
        <div className="row between">
          <h2 style={{ margin: 0 }}>Raw materials</h2>
          <button className="btn primary" onClick={() => setBuying(true)}>New purchase</button>
        </div>
        <p className="muted small">
          Log what you buy and count the shelf now and then. How fast something is used, and how
          many days are left, follow from those two on their own.
        </p>
        <div className="row wrap">
          <button className="btn" onClick={() => setSheet('situation')}>Print stock sheet</button>
          <button className="btn" onClick={() => setSheet('count')}>Print count sheet</button>
          <button className="btn ghost" onClick={() => setEditing({})}>Add a material</button>
        </div>
      </div>

      {short.length > 0 && (
        <div className="card">
          <h3>Running low</h3>
          <div className="attention">
            {short.map((m) => {
              const days = daysOfStock(m)
              return (
                <div className="attention-row" key={m.id}>
                  {m.name} — {m.onHand ?? 0} {m.unit} left
                  <div className="where">
                    {days === null
                      ? `under the reorder level of ${m.reorderLevel} ${m.unit}`
                      : `about ${Math.floor(days)} day${Math.floor(days) === 1 ? '' : 's'} at the current rate`}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div className="card">
        <div className="row between">
          <h3 style={{ margin: 0 }}>On hand</h3>
          <span className="muted small">worth {formatMoney(stockValue(live))}</span>
        </div>
        {list.length === 0 && <Empty>No materials yet — add flour, butter, boxes and the rest.</Empty>}
        <div className="scroll-x">
          <table>
            <thead>
              <tr>
                <th>Material</th>
                <th className="num">On hand</th>
                {/* Dropped under 680px rather than left to force a sideways
                    scroll before reaching Adjust/Edit — their values still
                    live in the muted line under the material's name. */}
                <th className="num hide-narrow">Used / day</th>
                <th className="num hide-narrow">Days left</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.map((m) => {
                const days = daysOfStock(m)
                return (
                  <tr key={m.id} className={m.active === false ? 'row-archived' : undefined}>
                    <td>
                      <b>{m.name}</b>
                      {/* Not --alert: the dedicated "Running low" card above
                          already flags this without red, and that colour is
                          reserved for money that does not add up. */}
                      {isLow(m) && m.active !== false && <span className="muted small"> · low</span>}
                      <div className="muted small">
                        <Money minor={m.costPerUnit ?? 0} /> per {m.unit}
                        {m.reorderLevel ? ` · reorder at ${m.reorderLevel}` : ''}
                        {/* Folded in here so the figure survives even where the
                            dedicated columns are hidden below 680px. */}
                        {m.usagePerDay ? ` · ${m.usagePerDay} ${m.unit}/day` : ''}
                        {days !== null ? ` · ${Math.floor(days)} days left` : ''}
                      </div>
                    </td>
                    <td className="num">{m.onHand ?? 0} {m.unit}</td>
                    <td className="num muted hide-narrow">{m.usagePerDay ? `${m.usagePerDay}` : '—'}</td>
                    <td className="num hide-narrow">{days === null ? '—' : Math.floor(days)}</td>
                    <td className="num">
                      <button className="btn ghost small" onClick={() => setMoving(m)}>Adjust</button>
                      <button className="btn ghost small" onClick={() => setEditing(m)}>Edit</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h3>Recent purchases</h3>
        {purchases.loading ? (
          // Without this guard, a still-loading list and a genuinely empty one
          // looked identical — "Nothing bought yet" on a slow connection reads
          // as a fact about the shop rather than as a read still in flight.
          <Loading inline>Loading recent purchases…</Loading>
        ) : (purchases.data ?? []).length === 0 ? (
          <Empty>Nothing bought yet.</Empty>
        ) : (
          <table>
            <thead>
              <tr><th>Purchase</th><th className="num">Total</th></tr>
            </thead>
            <tbody>
              {(purchases.data ?? []).map((p) => (
                <tr key={p.id}>
                  <td>
                    <b>{formatDate(p.businessDate)}</b>
                    <div className="muted small">
                      {(p.items ?? []).map((i) => `${i.materialName} ${i.qty}${i.unit}`).join(' · ')}
                    </div>
                  </td>
                  <td className="num"><Money minor={p.total} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {buying && (
        <PurchaseModal
          materials={live}
          last={purchases.data?.[0] ?? null}
          user={profile}
          onClose={() => setBuying(false)}
        />
      )}

      {moving && (
        <MovementModal material={moving} user={profile} onClose={() => setMoving(null)} />
      )}

      {editing && (
        <MaterialModal material={editing} others={list} onClose={() => setEditing(null)} />
      )}

      {sheet && (
        <Modal title="Stock sheet" onClose={() => setSheet(null)} wide>
          <StockSheet
            materials={list}
            reports={reports.data ?? []}
            branches={branches.data ?? []}
            countMode={sheet === 'count'}
          />
          <div className="grid2 no-print" style={{ marginTop: 16 }}>
            <button className="btn" onClick={printSheet}>Print</button>
            <button className="btn primary" onClick={() => setSheet(null)}>Done</button>
          </div>
        </Modal>
      )}
    </div>
  )
}

function PurchaseModal({ materials, last, user, onClose }) {
  // Pre-filled from the last delivery, because buying the same things every
  // week is the normal case — the owner adjusts a couple of numbers.
  const [lines, setLines] = useState(() =>
    Object.fromEntries(
      materials.map((m) => {
        const previous = last?.items?.find((i) => i.materialId === m.id)
        return [
          m.id,
          {
            qty: '',
            cost: formatMoney(previous?.unitCost ?? m.costPerUnit ?? 0, { symbol: false }),
          },
        ]
      }),
    ),
  )
  const [busy, setBusy] = useState(false)

  const items = materials
    .map((m) => {
      const qty = Number(String(lines[m.id]?.qty ?? '').replace(/[^0-9.]/g, ''))
      const unitCost = parseMoney(lines[m.id]?.cost)
      if (!qty || qty <= 0 || unitCost === null) return null
      return {
        materialId: m.id,
        materialName: m.name,
        unit: m.unit,
        qty,
        unitCost,
        onHandBefore: m.onHand ?? 0,
        receivedSinceCountBefore: m.receivedSinceCount ?? 0,
      }
    })
    .filter(Boolean)

  function repeatLast() {
    if (!last) return
    setLines((current) => {
      const next = { ...current }
      for (const item of last.items ?? []) {
        if (!next[item.materialId]) continue
        next[item.materialId] = {
          qty: String(item.qty),
          cost: formatMoney(item.unitCost, { symbol: false }),
        }
      }
      return next
    })
  }

  return (
    <Modal title="New purchase" onClose={onClose} wide>
      {last && (
        <button className="btn block" style={{ marginBottom: 14 }} onClick={repeatLast}>
          Same as last time ({formatDate(last.businessDate)} · {formatMoney(last.total)})
        </button>
      )}

      <div className="scroll-x">
        <table>
          <thead>
            <tr>
              <th>Material</th>
              <th className="num">Quantity</th>
              <th className="num">Cost per unit</th>
              <th className="num">Line</th>
            </tr>
          </thead>
          <tbody>
            {materials.map((m) => {
              const line = lines[m.id] ?? { qty: '', cost: '' }
              const qty = Number(String(line.qty).replace(/[^0-9.]/g, '')) || 0
              const cost = parseMoney(line.cost) ?? 0
              return (
                <tr key={m.id}>
                  <td>
                    {m.name}
                    <div className="muted small">per {m.unit} · {m.onHand ?? 0} on hand</div>
                  </td>
                  <td className="num" style={{ width: 110 }}>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={line.qty}
                      placeholder="0"
                      onChange={(e) =>
                        setLines((s) => ({ ...s, [m.id]: { ...s[m.id], qty: e.target.value } }))
                      }
                    />
                  </td>
                  <td className="num" style={{ width: 120 }}>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={line.cost}
                      onChange={(e) =>
                        setLines((s) => ({ ...s, [m.id]: { ...s[m.id], cost: e.target.value } }))
                      }
                    />
                  </td>
                  <td className="num">{qty > 0 ? formatMoney(Math.round(qty * cost)) : '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="total" style={{ marginTop: 14 }}>
        <span className="muted">Total</span>
        <b>{formatMoney(purchaseTotal(items))}</b>
      </div>

      <button
        className="btn primary big block"
        disabled={items.length === 0 || busy}
        onClick={() => {
          setBusy(true)
          recordPurchase({ items, user })
          onClose()
        }}
      >
        {items.length === 0 ? 'Enter what you bought' : `Save purchase — ${items.length} line(s)`}
      </button>
      <p className="muted small center" style={{ marginBottom: 0 }}>
        Saving also puts the stock on the shelf. You never enter a delivery twice.
      </p>
    </Modal>
  )
}

function MovementModal({ material, user, onClose }) {
  const [type, setType] = useState(COUNT)
  const [text, setText] = useState('')
  const qty = Number(text.replace(/[^0-9.]/g, ''))
  const valid = text.trim() !== '' && Number.isFinite(qty) && qty >= 0

  const chosen = MOVEMENTS.find((m) => m.type === type)

  return (
    <Modal title={material.name} onClose={onClose}>
      <div className="row wrap" style={{ marginBottom: 14 }}>
        {MOVEMENTS.map((m) => (
          <button
            key={m.type}
            className={`chip ${type === m.type ? 'on' : ''}`}
            onClick={() => setType(m.type)}
          >
            {m.label}
          </button>
        ))}
      </div>
      <p className="muted small">{chosen.hint}</p>

      <div className="field">
        <label>
          {type === COUNT
            ? `How much is actually there, in ${material.unit}`
            : `How much, in ${material.unit}`}
        </label>
        <input
          type="text"
          inputMode="decimal"
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={type === COUNT ? String(material.onHand ?? 0) : '0'}
        />
      </div>

      {type === COUNT && (
        <p className="muted small">
          The system thinks there is {material.onHand ?? 0} {material.unit}. Type what you actually
          counted — it works out the difference and how fast this is being used.
        </p>
      )}

      <button
        className="btn primary big block"
        disabled={!valid}
        onClick={() => {
          recordMovement({ material, type, qty, user })
          onClose()
        }}
      >
        Save
      </button>
    </Modal>
  )
}

function MaterialModal({ material, others, onClose }) {
  const [name, setName] = useState(material.name ?? '')
  const [unit, setUnit] = useState(material.unit ?? 'kg')
  const [cost, setCost] = useState(
    material.costPerUnit != null ? formatMoney(material.costPerUnit, { symbol: false }) : '',
  )
  const [reorder, setReorder] = useState(String(material.reorderLevel ?? ''))
  const [busy, setBusy] = useState(false)

  const costMinor = parseMoney(cost)
  const clash = others.find(
    (m) => m.id !== material.id && m.name.toLowerCase() === name.trim().toLowerCase(),
  )
  const valid = name.trim() && unit.trim() && costMinor !== null && !clash

  return (
    <Modal title={material.id ? 'Edit material' : 'Add a material'} onClose={onClose}>
      <div className="field">
        <label>Name</label>
        <input type="text" value={name} autoFocus onChange={(e) => setName(e.target.value)} />
        {clash && <p className="bad small">{clash.name} is already on the list.</p>}
      </div>
      <div className="field">
        <label>Unit it is bought in</label>
        <div className="row wrap">
          {['kg', 'litre', 'dozen', 'packet', 'bag', 'each'].map((u) => (
            <button key={u} className={`chip ${unit === u ? 'on' : ''}`} onClick={() => setUnit(u)}>
              {u}
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <label>Cost per {unit}</label>
        <input type="text" inputMode="numeric" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="0" />
      </div>
      <div className="field">
        <label>Tell me when it drops below (optional)</label>
        <input
          type="text"
          inputMode="decimal"
          value={reorder}
          onChange={(e) => setReorder(e.target.value)}
          placeholder="0"
        />
      </div>

      <button
        className="btn primary big block"
        disabled={!valid || busy}
        onClick={async () => {
          setBusy(true)
          try {
            await saveMaterial(material.id, {
              name: name.trim(),
              unit,
              costPerUnit: costMinor,
              reorderLevel: Number(reorder.replace(/[^0-9.]/g, '')) || 0,
            })
            onClose()
          } finally {
            setBusy(false)
          }
        }}
      >
        Save
      </button>

      {material.id && (
        <button
          className="btn ghost block"
          style={{ marginTop: 8 }}
          onClick={() => {
            archiveMaterial(material.id, material.active !== false)
            onClose()
          }}
        >
          {material.active === false ? 'Bring back into use' : 'No longer used'}
        </button>
      )}
    </Modal>
  )
}
