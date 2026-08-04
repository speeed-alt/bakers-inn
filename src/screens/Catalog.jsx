import { useState } from 'react'
import { collection } from 'firebase/firestore'
import { db } from '../firebase.js'
import { useSnapshot } from '../lib/hooks.js'
import { formatMoney, parseMoney } from '../lib/money.js'
import { PRODUCT_CATEGORIES, ROLES } from '../config.js'
import { archiveProduct, saveBranch, saveProduct, setUserActive } from '../data/catalog.js'
import { createStaff } from '../data/staff.js'
import { isValidPin } from '../lib/pin.js'
import { Empty, Modal, Money } from '../components/ui.jsx'

const TABS = ['Products', 'People', 'Outlets']

export default function Catalog() {
  const [tab, setTab] = useState('Products')
  return (
    <div className="page">
      <div className="row wrap" style={{ marginBottom: 16 }}>
        {TABS.map((t) => (
          <button key={t} className={`chip ${tab === t ? 'on' : ''}`} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </div>
      {tab === 'Products' && <Products />}
      {tab === 'People' && <People />}
      {tab === 'Outlets' && <Outlets />}
    </div>
  )
}

function Products() {
  const products = useSnapshot(() => collection(db, 'products'), [])
  const [editing, setEditing] = useState(null)

  const list = [...(products.data ?? [])].sort(
    (a, b) => (a.category ?? '').localeCompare(b.category ?? '') || a.name.localeCompare(b.name),
  )

  return (
    <>
      <div className="card">
        <div className="row between">
          <h2 style={{ margin: 0 }}>Products</h2>
          <button className="btn primary" onClick={() => setEditing({})}>
            Add product
          </button>
        </div>
        <p className="muted small" style={{ marginBottom: 0 }}>
          The code is what a cashier types at the till, so keep it short. A price change here
          reaches every till at the next sync; past sales keep the price they were actually rung at.
        </p>
      </div>

      <div className="card">
        {list.length === 0 && <Empty>No products yet.</Empty>}
        <div className="scroll-x">
          <table>
            <thead>
              <tr>
                <th>Code</th>
                <th>Name</th>
                <th>Category</th>
                <th className="num">Price</th>
                <th>Keeps?</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.map((p) => (
                <tr key={p.id} style={p.active === false ? { opacity: 0.45 } : undefined}>
                  <td className="mono small muted">{p.code}</td>
                  <td>{p.name}</td>
                  <td className="muted small">{p.category}</td>
                  <td className="num"><Money minor={p.price} /></td>
                  <td className="small muted">{p.sellsNextDay ? 'keeps' : 'same day'}</td>
                  <td className="num">
                    <button className="btn ghost small" onClick={() => setEditing(p)}>Edit</button>
                    <button
                      className="btn ghost small"
                      onClick={() => archiveProduct(p.id, p.active !== false)}
                    >
                      {p.active === false ? 'Restore' : 'Archive'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {editing && (
        <ProductModal product={editing} others={list} onClose={() => setEditing(null)} />
      )}
    </>
  )
}

function ProductModal({ product, others, onClose }) {
  const [code, setCode] = useState(product.code ?? '')
  const [name, setName] = useState(product.name ?? '')
  const [category, setCategory] = useState(product.category ?? PRODUCT_CATEGORIES[0])
  const [price, setPrice] = useState(
    product.price != null ? formatMoney(product.price, { symbol: false }) : '',
  )
  const [keeps, setKeeps] = useState(product.sellsNextDay ?? false)
  const [busy, setBusy] = useState(false)

  const minor = parseMoney(price)
  // Two items sharing a code would make the till ambiguous, so it is blocked here.
  const clash = others.find(
    (p) => p.id !== product.id && String(p.code ?? '').toLowerCase() === code.trim().toLowerCase(),
  )
  const valid = code.trim() && name.trim() && minor !== null && minor >= 0 && !clash

  async function save() {
    setBusy(true)
    try {
      await saveProduct(product.id, {
        code: code.trim(),
        name: name.trim(),
        category,
        price: minor,
        sellsNextDay: keeps,
      })
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={product.id ? 'Edit product' : 'Add product'} onClose={onClose}>
      <div className="field">
        <label>Code — what the cashier types</label>
        <input
          type="text"
          value={code}
          autoFocus
          inputMode="numeric"
          onChange={(e) => setCode(e.target.value)}
          placeholder="e.g. 401"
        />
        {clash && <p className="bad small">Code {code.trim()} is already used by {clash.name}.</p>}
      </div>
      <div className="field">
        <label>Name</label>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="field">
        <label>Category</label>
        <select value={category} onChange={(e) => setCategory(e.target.value)}>
          {PRODUCT_CATEGORIES.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </div>
      <div className="field">
        <label>Price</label>
        <input
          type="text"
          inputMode="decimal"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          placeholder="0"
        />
      </div>
      <div className="field">
        <label>Does it still sell the next day?</label>
        <div className="row wrap">
          <button className={`chip ${!keeps ? 'on' : ''}`} onClick={() => setKeeps(false)}>
            No — same day only
          </button>
          <button className={`chip ${keeps ? 'on' : ''}`} onClick={() => setKeeps(true)}>
            Yes — it keeps
          </button>
        </div>
        <p className="muted small">
          This decides whether leftovers default to waste or to carry over at the daily close.
        </p>
      </div>
      <button className="btn primary big block" disabled={!valid || busy} onClick={save}>
        Save
      </button>
    </Modal>
  )
}

function People() {
  const users = useSnapshot(() => collection(db, 'users'), [])
  const branches = useSnapshot(() => collection(db, 'branches'), [])
  const [adding, setAdding] = useState(false)

  const list = [...(users.data ?? [])].sort((a, b) => a.name.localeCompare(b.name))
  const branchName = (id) => branches.data?.find((b) => b.id === id)?.name ?? id

  return (
    <>
      <div className="card">
        <div className="row between">
          <h2 style={{ margin: 0 }}>People</h2>
          <button className="btn primary" onClick={() => setAdding(true)}>Add person</button>
        </div>
      </div>

      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Role</th>
              <th>Outlet</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {list.map((u) => (
              <tr key={u.id} style={u.active === false ? { opacity: 0.45 } : undefined}>
                <td>{u.name}</td>
                <td className="muted small">{u.role}</td>
                <td className="muted small">{branchName(u.branchId)}</td>
                <td className="num">
                  <button
                    className="btn ghost small"
                    onClick={() => setUserActive(u.id, u.active === false)}
                  >
                    {u.active === false ? 'Turn on' : 'Turn off'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted small">
          Turning someone off stops them signing in. Their past sales stay exactly as they were.
        </p>
      </div>

      {adding && <PersonModal branches={branches.data ?? []} onClose={() => setAdding(false)} />}
    </>
  )
}

function PersonModal({ branches, onClose }) {
  const [name, setName] = useState('')
  const [role, setRole] = useState('cashier')
  const [branchId, setBranchId] = useState(branches[0]?.id ?? '')
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const valid = name.trim() && branchId && isValidPin(pin)

  async function save() {
    setBusy(true)
    setError('')
    try {
      await createStaff({ name: name.trim(), role, branchId, pin })
      onClose()
    } catch (e) {
      setError(e.message ?? 'Could not add this person.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="Add person" onClose={onClose}>
      <div className="field">
        <label>Name</label>
        <input type="text" value={name} autoFocus onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="field">
        <label>Role</label>
        <div className="row wrap">
          {ROLES.map((r) => (
            <button key={r} className={`chip ${role === r ? 'on' : ''}`} onClick={() => setRole(r)}>
              {r}
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <label>Outlet</label>
        <div className="row wrap">
          {branches.map((b) => (
            <button
              key={b.id}
              className={`chip ${branchId === b.id ? 'on' : ''}`}
              onClick={() => setBranchId(b.id)}
            >
              {b.name}
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <label>4-digit PIN</label>
        <input
          type="text"
          inputMode="numeric"
          maxLength={4}
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
        />
      </div>
      {error && <p className="bad small">{error}</p>}
      <button className="btn primary big block" disabled={!valid || busy} onClick={save}>
        Add
      </button>
    </Modal>
  )
}

function Outlets() {
  const branches = useSnapshot(() => collection(db, 'branches'), [])
  const [adding, setAdding] = useState(false)
  const [id, setId] = useState('')
  const [name, setName] = useState('')

  return (
    <>
      <div className="card">
        <div className="row between">
          <h2 style={{ margin: 0 }}>Outlets</h2>
          <button className="btn primary" onClick={() => setAdding(true)}>Add outlet</button>
        </div>
      </div>
      <div className="card">
        <table>
          <thead>
            <tr><th>Code</th><th>Name</th><th>Role</th></tr>
          </thead>
          <tbody>
            {(branches.data ?? []).map((b) => (
              <tr key={b.id}>
                <td className="mono">{b.id}</td>
                <td>{b.name}</td>
                <td className="muted small">{b.isMain ? 'hub — buys, bakes, distributes' : 'shop'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {adding && (
        <Modal title="Add outlet" onClose={() => setAdding(false)}>
          <div className="field">
            <label>Short code (appears on every receipt, e.g. B4)</label>
            <input
              type="text"
              value={id}
              onChange={(e) => setId(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
            />
          </div>
          <div className="field">
            <label>Name</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <button
            className="btn primary big block"
            disabled={!id || !name.trim()}
            onClick={async () => {
              await saveBranch(id, { name: name.trim(), isMain: false })
              setAdding(false)
              setId('')
              setName('')
            }}
          >
            Add
          </button>
        </Modal>
      )}
    </>
  )
}
