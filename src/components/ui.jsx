import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { formatMoney } from '../lib/money.js'

export function Money({ minor, symbol = true }) {
  return <span className="mono">{formatMoney(minor, { symbol })}</span>
}

export function Modal({ title, onClose, children, wide = false }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose?.()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Rendered outside the app tree. That keeps stacking simple, and it is what
  // lets printing hide the whole application and put a receipt on the roll on
  // its own — a dialog nested inside the till could not be separated from it.
  return createPortal(
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className="modal" style={wide ? { maxWidth: 680 } : undefined} role="dialog" aria-modal="true">
        {title && <h2>{title}</h2>}
        {children}
      </div>
    </div>,
    document.body,
  )
}

export function Stepper({ value, onChange, min = 0, max = 9999 }) {
  return (
    <div className="stepper">
      <button type="button" aria-label="one less" onClick={() => onChange(Math.max(min, value - 1))}>
        –
      </button>
      <span className="qty">{value}</span>
      <button type="button" aria-label="one more" onClick={() => onChange(Math.min(max, value + 1))}>
        +
      </button>
    </div>
  )
}

export function Empty({ children }) {
  return <p className="muted center" style={{ padding: '32px 16px' }}>{children}</p>
}

export function Loading() {
  return <Empty>Loading…</Empty>
}
