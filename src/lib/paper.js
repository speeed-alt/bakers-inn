import { RECEIPT_PAPER } from '../config.js'

// Page size cannot be chosen with a CSS variable — `@page { size: ... }` only
// accepts a literal — so the rule is written at start-up and swapped whenever
// something of a different shape is printed.
//
// Two shapes exist: a receipt, which is a narrow strip of characters, and a
// sheet, which is an ordinary page. Printing one with the other's page set up
// is how slips end up as a stamp in the corner of an A4 page.

// `pt` is the receipt's root size; everything inside it is sized in ems from
// there, so one number per paper sets the whole slip.
//
// These used to be worked out from how many monospace characters had to fit
// across the roll. The slip is a real table now and stretches to whatever it is
// given, so the size is chosen for legibility instead: about 9pt on a till roll
// is what the printed bills here use, and a bigger sheet can carry more without
// looking like large print.
/**
 * How long a page the till roll is given.
 *
 * `@page { size: ... }` takes one or two lengths, `auto`, or a named page size
 * — and nothing else. `80mm auto` mixes a length with the keyword, which is not
 * in the grammar, so the browser threw the whole declaration away and printed
 * on whatever the print dialog happened to be set to. It looked right in the
 * file, and nowhere else. Both lengths have to be given.
 *
 * 200mm is about forty-five lines at 9pt, which is more than any bakery slip
 * needs. It is a ceiling, not a length of paper: what actually comes out is
 * decided by the printer's own driver, and a roll set up as continuous media
 * cuts after the last line. **If the real printer feeds blank paper after every
 * slip, this is the number to bring down** — that is the one thing to watch on
 * the fifty test receipts, and it cannot be settled without the hardware.
 */
const ROLL_LENGTH = '200mm'

const PAPERS = {
  '80mm': { size: `80mm ${ROLL_LENGTH}`, margin: '3mm', pt: 9 },
  a5: { size: 'A5 portrait', margin: '8mm', pt: 11 },
  a4: { size: 'A4 portrait', margin: '12mm', pt: 12 },
}

/**
 * Is this something `@page { size: … }` will actually accept?
 *
 * Here so a test can ask. The failure this exists for is silent: an invalid
 * value is not an error, it is a declaration the browser discards, and the
 * only symptom is a slip printed in the corner of an A4 sheet weeks later.
 */
const LENGTH = String.raw`\d+(?:\.\d+)?(?:mm|cm|in|pt|pc|px|q)`
const PAGE_SIZE = /^(?:a[3-5]|b[45]|letter|legal|ledger)$/i
const ORIENTATION = /^(?:portrait|landscape)$/i

export function isValidPageSize(value) {
  const parts = String(value ?? '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0 || parts.length > 2) return false

  // `auto` stands alone — this is the exact mistake that shipped.
  if (parts.some((p) => p.toLowerCase() === 'auto')) return parts.length === 1

  const isLength = (p) => new RegExp(`^${LENGTH}$`, 'i').test(p)
  if (parts.every(isLength)) return true

  const [first, second] = parts
  if (PAGE_SIZE.test(first)) return second === undefined || ORIENTATION.test(second)
  if (ORIENTATION.test(first)) return second !== undefined && PAGE_SIZE.test(second)
  return false
}

export const PAPER_SIZES = Object.fromEntries(
  Object.entries(PAPERS).map(([name, spec]) => [name, spec.size]),
)

let styleEl = null

function rule(text) {
  if (!styleEl) {
    styleEl = document.createElement('style')
    styleEl.dataset.paper = 'true'
    document.head.appendChild(styleEl)
  }
  styleEl.textContent = text
}

const PX_PER_MM = 96 / 25.4

/**
 * How long this particular slip is, in millimetres, at the size it will print.
 *
 * A roll has no pages — it has a length of paper and a cutter — so a fixed page
 * height either truncates a long bill or feeds blank paper after a short one.
 * Neither is acceptable when the shop is buying the roll.
 *
 * So the slip is measured just before printing. It is cloned into the live
 * document rather than measured where it sits, because on screen it is 13px in
 * a padded card and on paper it is 9pt across 74mm; and cloned into the *live*
 * document rather than a bare one, because the last time a receipt was checked
 * against a stripped-down copy of its own CSS the copy left out the app's
 * global table rules and the preview lied about what came out.
 *
 * Returns null when there is nothing to measure — at start-up, or when a sheet
 * is being printed — and the caller falls back to the fixed length.
 */
function measuredLength(spec, marginMm) {
  if (typeof document === 'undefined') return null
  const source = document.querySelector('.receipt')
  if (!source) return null

  const printableMm = 80 - marginMm * 2
  const host = document.createElement('div')
  host.setAttribute('aria-hidden', 'true')
  host.style.cssText =
    `position:fixed;left:-99999px;top:0;width:${printableMm * PX_PER_MM}px;` +
    'visibility:hidden;pointer-events:none;'

  const clone = source.cloneNode(true)
  clone.style.cssText = `font-size:${spec.pt}pt;width:auto;padding:0;background:#fff;`
  host.appendChild(clone)
  document.body.appendChild(host)

  const heightMm = clone.getBoundingClientRect().height / PX_PER_MM
  host.remove()

  if (!Number.isFinite(heightMm) || heightMm <= 0) return null
  // Slack for the difference between this measurement and the print engine's
  // own line breaking, which is close but not identical. Cutting a slip short
  // is far worse than a centimetre of paper.
  const total = Math.ceil(heightMm) + marginMm * 2 + 8
  return Math.min(Math.max(total, 60), 400)
}

/** Set the page up for a receipt on whatever paper the shop actually uses. */
export function applyPaperSettings(paper = RECEIPT_PAPER) {
  const spec = PAPERS[paper] ?? PAPERS['80mm']
  // Only the roll is cut to the slip. A5 and A4 are sheets: they are the size
  // they are whether the bill fills them or not.
  const rollMm = paper === '80mm' ? measuredLength(spec, 3) : null
  const size = rollMm ? `80mm ${rollMm}mm` : spec.size
  rule(`@page { size: ${size}; margin: ${spec.margin}; }
@media print {
  .receipt { font-size: ${spec.pt}pt; width: auto; padding: 0; background: #fff; }
  /* Rules have to be genuinely black on a thermal head. Anything grey is
     dithered into a dotted line that reads as a printer running out of heat. */
  .receipt th, .receipt td { border-color: #000 !important; }
}`)
  return { paper, pt: spec.pt, size }
}

export function printReceipt() {
  applyPaperSettings()
  window.print()
}

/**
 * Print a full-page document — a stock sheet, a report. Always an ordinary
 * sheet, never the till roll, whatever receipts are set to.
 */
export function printSheet({ landscape = false } = {}) {
  const spec = PAPERS.a4
  // The register is eleven columns of rupees and does not fit portrait.
  const size = landscape ? 'A4 landscape' : spec.size
  rule(`@page { size: ${size}; margin: ${spec.margin}; }
@media print { .sheet { font-size: 10.5pt; } }`)
  window.print()
  // Leave receipts working straight afterwards, so a printed sheet cannot
  // quietly reformat the next customer's slip.
  setTimeout(applyPaperSettings, 500)
}
