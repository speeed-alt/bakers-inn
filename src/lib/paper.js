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
const PAPERS = {
  '80mm': { size: '80mm auto', margin: '3mm', pt: 9 },
  a5: { size: 'A5 portrait', margin: '8mm', pt: 11 },
  a4: { size: 'A4 portrait', margin: '12mm', pt: 12 },
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
  rule(`@page { size: ${spec.size}; margin: ${spec.margin}; }
@media print {
  .receipt { font-size: ${spec.pt}pt; width: auto; padding: 0; background: #fff; }
  /* Rules have to be genuinely black on a thermal head. Anything grey is
     dithered into a dotted line that reads as a printer running out of heat. */
  .receipt th, .receipt td { border-color: #000 !important; }
}`)
  return { paper, pt: spec.pt }
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
