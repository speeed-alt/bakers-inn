import { useState } from 'react'
import { collection } from 'firebase/firestore'
import { db } from '../firebase.js'
import { useSnapshot } from '../lib/hooks.js'
import { formatMoney, parseMoney } from '../lib/money.js'
import { DEFAULT_WEIGHT_UNIT } from '../lib/quantity.js'
import { mergeSuggestions, planMerge } from '../lib/grouping.js'
import { PRODUCT_CATEGORIES, ROLES } from '../config.js'
import { archiveProduct, saveBranch, saveProduct, setUserActive } from '../data/catalog.js'
import { createStaff } from '../data/staff.js'
import { isValidPin } from '../lib/pin.js'
import { Empty, Loading, Modal, Money } from '../components/ui.jsx'

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

  // An empty catalog and a catalog that has not arrived look identical, and the
  // wrong one of those invites somebody to start adding products that already
  // exist.
  if (products.loading) {
    return (
      <div className="card">
        <Loading>Reading the catalog…</Loading>
      </div>
    )
  }

  return (
    <>
      <MergeByPrice products={list} />

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
                {/* "Details", not "Keeps?": same-day/keeps, per-kg, daily-rate
                    and merged-names all land in this one column. */}
                <th>Details</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.map((p) => (
                <tr key={p.id} className={p.active === false ? 'row-archived' : undefined}>
                  <td className="mono small muted">{p.code}</td>
                  <td>{p.name}</td>
                  <td className="muted small">{p.category}</td>
                  <td className="num"><Money minor={p.price} /></td>
                  <td className="small muted">
                    {p.sellsNextDay ? 'keeps' : 'same day'}
                    {p.soldByWeight && ` · per ${p.unit || DEFAULT_WEIGHT_UNIT}`}
                    {p.dailyRate && ' · daily rate'}
                    {p.variants?.length > 1 && ` · ${p.variants.length} names`}
                  </td>
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

/**
 * Give one id to everything in a category at the same price.
 *
 * Five cakes at Rs 2,000 become one code, one stock line and one order row —
 * with the five names kept underneath, so the cashier still picks which cake
 * and the customer's slip still says Lotus.
 *
 * The card only appears when there is something to merge, and it says what is
 * lost before it does anything. That cost is real: once they share an id the
 * system can count ten cakes sold but can no longer say which ten.
 */
function MergeByPrice({ products }) {
  const groups = mergeSuggestions(products)
  const [open, setOpen] = useState(null)

  if (groups.length === 0) return null

  return (
    <div className="card">
      <div className="row between">
        <h3 style={{ margin: 0 }}>Same category, same price</h3>
        <span className="muted small">{groups.length} could share a code</span>
      </div>
      <p className="muted small">
        Give these one code so the till has fewer numbers to remember. The names stay — the cashier
        picks which one and the receipt says it.
      </p>
      <div className="attention">
        {groups.map((group) => (
          <div className="attention-row" key={group.key}>
            <div className="row between">
              <span>
                {group.category} · <Money minor={group.price} />
                <div className="where">{group.variants.join(', ')}</div>
              </span>
              <button className="btn small" onClick={() => setOpen(group)}>
                Merge {group.members.length}
              </button>
            </div>
          </div>
        ))}
      </div>

      {open && <MergeModal group={open} onClose={() => setOpen(null)} />}
    </div>
  )
}

function MergeModal({ group, onClose }) {
  const [name, setName] = useState(group.suggestedName)
  const [code, setCode] = useState(group.keepCode)
  const [busy, setBusy] = useState(false)
  const plan = planMerge(group, { name: name.trim(), code: code.trim() })

  async function merge() {
    setBusy(true)
    try {
      await saveProduct(plan.keep.id, {
        code: plan.keep.code,
        name: plan.keep.name,
        category: plan.keep.category,
        price: plan.keep.price,
        sellsNextDay: plan.keep.sellsNextDay,
        variants: plan.keep.variants,
      })
      // Archived, never deleted: every sale ever rung against these still has
      // to make sense, and they carry their own name and price anyway.
      for (const gone of plan.archive) await archiveProduct(gone.id, true)
      onClose()
    } catch (error) {
      console.error('[bakery] merge failed', error)
      setBusy(false)
    }
  }

  return (
    <Modal title={`Merge ${group.members.length} items`} onClose={onClose}>
      <div className="field">
        <label>Code the cashier types</label>
        <input type="text" inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value)} />
      </div>
      <div className="field">
        <label>Name on the till</label>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
      </div>

      <h3>What the cashier will pick between</h3>
      <div className="bill" style={{ marginBottom: 12 }}>
        {plan.keep.variants.map((variant) => (
          <div className="bill-row" key={variant}>
            <span className="bill-code" />
            <span className="bill-name">{variant}</span>
            <span />
            <span className="bill-amount"><Money minor={group.price} /></span>
          </div>
        ))}
      </div>

      <p className="muted small">
        <b>What you gain:</b> one code, one stock line and one order row instead of{' '}
        {group.members.length}.
        <br />
        <b>What you lose:</b> the system will know that ten of these sold, but not which ten. Sales
        already rung keep their own names, so nothing that has happened changes.
      </p>

      <button className="btn primary big block" disabled={busy || !code.trim() || !name.trim()} onClick={merge}>
        {busy ? 'Merging…' : `Give all ${group.members.length} the code ${code.trim()}`}
      </button>
    </Modal>
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
  const [daily, setDaily] = useState(product.dailyRate ?? false)
  const [weighed, setWeighed] = useState(product.soldByWeight ?? false)
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
        dailyRate: daily,
        soldByWeight: weighed,
        unit: weighed ? DEFAULT_WEIGHT_UNIT : null,
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
        <label>Is it counted, or weighed?</label>
        <div className="row wrap">
          <button className={`chip ${!weighed ? 'on' : ''}`} onClick={() => setWeighed(false)}>
            Counted — each
          </button>
          <button className={`chip ${weighed ? 'on' : ''}`} onClick={() => setWeighed(true)}>
            Weighed — per {DEFAULT_WEIGHT_UNIT}
          </button>
        </div>
        <p className="muted small">
          A weighed item is priced per {DEFAULT_WEIGHT_UNIT} and the cashier types what the customer
          asked for — 4.5, or 450g. Everything else is sold one at a time.
        </p>
      </div>
      <div className="field">
        <label>
          {weighed
            ? `Price per ${DEFAULT_WEIGHT_UNIT}${daily ? ' — this morning’s rate' : ''}`
            : daily ? 'Price — this morning’s rate' : 'Price'}
        </label>
        <input
          type="text"
          inputMode="decimal"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          placeholder="0"
        />
      </div>
      <div className="field">
        <label>Does its price change from day to day?</label>
        <div className="row wrap">
          <button className={`chip ${!daily ? 'on' : ''}`} onClick={() => setDaily(false)}>
            No — one price
          </button>
          <button className={`chip ${daily ? 'on' : ''}`} onClick={() => setDaily(true)}>
            Yes — set it each morning
          </button>
        </div>
        <p className="muted small">
          For the things that are bought fresh and priced fresh — eggs, and bread when flour moves.
          These appear together on the dashboard each morning so all three outlets are priced in one
          go. Until a rate is entered the till charges the last one, so nobody stops selling.
        </p>
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

  // Without this, a still-loading list and a genuinely empty one looked
  // identical — the risk on this specific screen is real: someone re-adding
  // an outlet or a person that already exists because the table looked empty.
  if (users.loading || branches.loading) {
    return <div className="card"><Loading>Reading the team…</Loading></div>
  }

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
              <tr key={u.id} className={u.active === false ? 'row-archived' : undefined}>
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
  const [renaming, setRenaming] = useState(null)
  const [id, setId] = useState('')
  const [name, setName] = useState('')

  if (branches.loading) {
    return <div className="card"><Loading>Reading the team…</Loading></div>
  }

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
            <tr><th>Code</th><th>Name</th><th>Role</th><th /></tr>
          </thead>
          <tbody>
            {(branches.data ?? []).map((b) => (
              <tr key={b.id}>
                <td className="mono">{b.id}</td>
                <td>{b.name}</td>
                <td className="muted small">{b.isMain ? 'hub — buys, bakes, distributes' : 'shop'}</td>
                <td className="num">
                  <button className="btn ghost small" onClick={() => setRenaming(b)}>Edit</button>
                </td>
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
              autoFocus
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

      {/* Renaming was simply missing: an outlet could be added and never
          corrected, so the shops sat under whatever name they were first given
          — which is why the live login screen still read "Main Outlet" and
          "Model Town" long after the real names were known.

          The code is not editable, and that is the point. It is written into
          every document id in the system (S-20260813-B2-…, C-20260813-MAIN),
          so a shop can move or be renamed freely, but re-lettering one would
          orphan its whole history. */}
      {renaming && (
        <RenameOutlet branch={renaming} onClose={() => setRenaming(null)} />
      )}
    </>
  )
}

function RenameOutlet({ branch, onClose }) {
  const [name, setName] = useState(branch.name ?? '')
  const [address, setAddress] = useState(branch.address ?? '')
  const [phone, setPhone] = useState(branch.phone ?? '')
  const [busy, setBusy] = useState(false)

  const changed =
    name.trim() &&
    (name.trim() !== branch.name ||
      address.trim() !== (branch.address ?? '') ||
      phone.trim() !== (branch.phone ?? ''))

  return (
    <Modal title={branch.name} onClose={onClose}>
      <div className="field">
        <label>Name — what staff and customers see</label>
        <input type="text" value={name} autoFocus onChange={(e) => setName(e.target.value)} />
      </div>

      {/* Printed at the top of this shop's own receipts. Each outlet has its
          own, because a customer coming back about a wrong order needs the
          address of the counter they actually stood at, not the head office. */}
      <div className="field">
        <label>Address — printed on this shop's receipts</label>
        <input
          type="text"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="e.g. Main Gate Wala Chowk, Faisalabad"
        />
      </div>
      <div className="field">
        <label>Phone — printed on this shop's receipts</label>
        <input
          type="text"
          inputMode="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="e.g. 0304-4218406"
        />
      </div>

      <p className="muted small">
        The code <b className="mono">{branch.id}</b> does not change. It is printed on every receipt
        this shop has ever issued and cannot be altered without losing that history.
      </p>
      <div className="grid2">
        <button className="btn" onClick={onClose}>Cancel</button>
        <button
          className="btn primary"
          disabled={!changed || busy}
          onClick={async () => {
            setBusy(true)
            try {
              await saveBranch(branch.id, {
                name: name.trim(),
                address: address.trim(),
                phone: phone.trim(),
              })
              onClose()
            } finally {
              setBusy(false)
            }
          }}
        >
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
    </Modal>
  )
}
