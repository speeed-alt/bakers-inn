import { RECEIPT_PAPER, RECEIPT_WIDTH } from '../config.js'

// Page size cannot be chosen with a CSS variable — `@page { size: ... }` only
// accepts a literal — so the rule is written at start-up and swapped whenever
// something of a different shape is printed.
//
// Two shapes exist: a receipt, which is a narrow strip of characters, and a
// sheet, which is an ordinary page. Printing one with the other's page set up
// is how slips end up as a stamp in the corner of an A4 page.

const PAPERS = {
  '80mm': { size: '80mm auto', margin: '3mm', width: 74 },
  a5: { size: 'A5 portrait', margin: '8mm', width: 132 },
  a4: { size: 'A4 portrait', margin: '12mm', width: 186 },
}

// A monospace glyph is about 0.6 of the font size wide.
const CHAR_RATIO = 0.6
const MM_PER_PT = 25.4 / 72

/** Font size, in points, that makes RECEIPT_WIDTH characters span `widthMm`. */
export function fontSizeFor(widthMm, chars = RECEIPT_WIDTH) {
  return widthMm / chars / CHAR_RATIO / MM_PER_PT
}

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
  const pt = Math.round(fontSizeFor(spec.width) * 10) / 10
  rule(`@page { size: ${spec.size}; margin: ${spec.margin}; }
@media print { .receipt { font-size: ${pt}pt; width: auto; } }`)
  return { paper, pt }
}

export function printReceipt() {
  applyPaperSettings()
  window.print()
}

/**
 * Print a full-page document — a stock sheet, a report. Always an ordinary
 * sheet, never the till roll, whatever receipts are set to.
 */
export function printSheet() {
  const spec = PAPERS.a4
  rule(`@page { size: ${spec.size}; margin: ${spec.margin}; }
@media print { .sheet { font-size: 10.5pt; } }`)
  window.print()
  // Leave receipts working straight afterwards, so a printed sheet cannot
  // quietly reformat the next customer's slip.
  setTimeout(applyPaperSettings, 500)
}
