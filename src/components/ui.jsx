import { useEffect, useState } from 'react'
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

/**
 * A quantity: type it, or nudge it.
 *
 * The number is an input, not a label. Ordering forty loaves by tapping + forty
 * times is the kind of thing that makes people keep using paper, and it was the
 * owner's first complaint about this screen. The arrows stay for one or two
 * more, which is genuinely faster than reaching for a keyboard.
 *
 * The field holds its own text while being edited so that clearing it does not
 * snap to 0 under the cursor. Whatever is left when focus goes — including
 * nothing — settles back to a real number.
 */
export function Stepper({
  value,
  onChange,
  min = 0,
  max = 9999,
  label,
  // A weighed line steps by a quarter kilo and accepts "450g"; a counted one
  // steps by one and accepts digits. Both arrive as props so this component
  // never has to know which kind of product it is showing.
  step = 1,
  parse,
  format,
}) {
  const [text, setText] = useState(null)
  const clamp = (n) => Math.min(max, Math.max(min, n))
  const read = parse ?? ((raw) => {
    const n = Number.parseInt(raw, 10)
    return Number.isFinite(n) ? n : null
  })
  const show = format ?? ((n) => String(Math.round(n ?? 0)))
  const shown = text ?? show(value)

  function nudge(by) {
    // Re-rounded through the formatter so a quarter-kilo step cannot drift into
    // 4.750000000000001 after a few taps.
    const next = clamp((Number(value) || 0) + by)
    const parsed = read(String(Number(next.toFixed(3))))
    onChange(parsed ?? next)
    setText(null)
  }

  function commit(raw) {
    const parsed = read(raw)
    // Unreadable input leaves the line as it was rather than silently zeroing
    // it — a mistyped weight should not become a free bag of biscuits.
    onChange(parsed === null ? value : clamp(parsed))
    setText(null)
  }

  return (
    <div className="stepper">
      <button type="button" aria-label="less" onClick={() => nudge(-step)}>–</button>
      <input
        className="qty"
        type="text"
        inputMode={step < 1 ? 'decimal' : 'numeric'}
        aria-label={label ?? 'quantity'}
        value={shown}
        onChange={(e) => setText(e.target.value)}
        // Select all on focus: the next thing typed replaces the quantity
        // rather than landing beside it and making 4 into 42.
        onFocus={(e) => e.target.select()}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.target.blur()
          if (e.key === 'ArrowUp') { e.preventDefault(); nudge(step) }
          if (e.key === 'ArrowDown') { e.preventDefault(); nudge(-step) }
        }}
      />
      <button type="button" aria-label="more" onClick={() => nudge(step)}>+</button>
    </div>
  )
}

export function Empty({ children }) {
  return <p className="muted center" style={{ padding: '32px 16px' }}>{children}</p>
}

/**
 * A spinner with words next to it.
 *
 * Both halves matter. Without motion it reads as a screen that has stopped;
 * without words it says nothing about which of a dozen reads is slow. Saying
 * what is being fetched turns a suspicious pause into an explained one, which
 * is the difference between a cashier waiting and a cashier reaching for the
 * paper pad.
 */
export function Loading({ children = 'Loading…', inline = false }) {
  return (
    <div className={inline ? 'loading-note inline' : 'loading-note'} role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <span>{children}</span>
    </div>
  )
}
