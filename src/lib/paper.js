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
 * The page the till roll is given.
 *
 * `@page { size: ... }` takes one or two lengths, `auto`, or a named page size
 * — and nothing else. `80mm auto` mixes a length with the keyword, which is not
 * in the grammar, so the browser threw the whole declaration away and printed on
 * whatever the print dialog happened to be set to. Both lengths have to be given.
 *
 * **The height has to be one the printer's driver actually offers.** A till
 * printer does not present a roll of unlimited length to Windows; it presents a
 * short list of fixed media — the POS-80 here offers 80x210, 80x297 and 80x3276
 * — and Chrome lays the CSS page out *inside* whichever of those is selected.
 * The two have to agree, because Chrome does not simply print what it is asked
 * for when they do not:
 *
 *   - a page **shorter** than the media is floated inside the sheet rather than
 *     printed short, which is where the band of blank above and below the slip
 *     came from;
 *   - a page of a **different width** is shrunk whole to fit, which is how an A5
 *     receipt arrived on the roll as a stamp in the middle of the page.
 *
 * So 210mm is neither a ceiling nor an estimate. It is the shortest paper the
 * driver offers, named exactly. **If the shop's printer is set to one of the
 * other two, change this to match it** — this and the Windows paper setting are
 * two halves of one setting, and RECEIPT_PAPER in src/config.js says so too.
 *
 * This used to measure the slip and ask for a page cut to it, on the reasoning
 * that a roll has no pages. That is right about the paper and wrong about the
 * browser: Chrome has no continuous page either, so a measured 98mm page did not
 * become a 98mm slip — it became a 98mm page adrift in the driver's 210mm one.
 * How much paper actually comes out is the driver's business; it feeds what it
 * rasters and cuts where its own paper-cut setting says. That is a thing to
 * settle on the test receipts, not in here.
 */
const ROLL_LENGTH = '210mm'

const PAPERS = {
  // 4mm margins leave 72mm of content, which is the printable width of a
  // 576-dot head — the usual 80mm printer. At 3mm the slip was 74mm, and the two
  // millimetres hanging over the edge take the right-hand rule of the Amount
  // column with them.
  '80mm': { size: `80mm ${ROLL_LENGTH}`, margin: '4mm', pt: 9 },
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

/** Set the page up for a receipt on whatever paper the shop actually uses. */
export function applyPaperSettings(paper = RECEIPT_PAPER) {
  const spec = PAPERS[paper] ?? PAPERS['80mm']
  rule(`@page { size: ${spec.size}; margin: ${spec.margin}; }
@media print {
  .receipt { font-size: ${spec.pt}pt; width: auto; padding: 0; background: #fff; }
  /* Rules have to be genuinely black on a thermal head. Anything grey is
     dithered into a dotted line that reads as a printer running out of heat. */
  .receipt th, .receipt td { border-color: #000 !important; }
}`)
  return { paper, pt: spec.pt, size: spec.size }
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
