import { formatMoney } from './money.js'

// The accountant's interface. Deliberately CSV rather than an integration: it
// opens in whatever they already use, and nothing has to be retyped.

/** Quote only when needed, and double any quotes inside — Excel-safe. */
export function csvCell(value) {
  if (value === null || value === undefined) return ''
  const text = String(value)
  if (!/[",\n\r]/.test(text)) return text
  return `"${text.replaceAll('"', '""')}"`
}

export function toCsv(rows = []) {
  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n')
}

const money = (minor) => formatMoney(minor ?? 0, { symbol: false }).replaceAll(',', '')

export function salesCsv(sales = []) {
  const rows = [['Ref', 'Date', 'Outlet', 'Cashier', 'Payment', 'Status', 'Item', 'Qty', 'Unit price', 'Line total']]
  for (const sale of sales) {
    for (const item of sale.items ?? []) {
      rows.push([
        sale.ref,
        sale.businessDate,
        sale.branchId,
        sale.cashierName,
        sale.payment,
        sale.status,
        item.name,
        item.qty,
        money(item.price),
        money(item.price * item.qty),
      ])
    }
  }
  return toCsv(rows)
}

export function purchasesCsv(purchases = []) {
  const rows = [['Ref', 'Date', 'Supplier', 'Material', 'Unit', 'Qty', 'Cost per unit', 'Line total']]
  for (const purchase of purchases) {
    for (const item of purchase.items ?? []) {
      rows.push([
        purchase.ref,
        purchase.businessDate,
        purchase.supplier ?? '',
        item.materialName,
        item.unit,
        item.qty,
        money(item.unitCost),
        money(item.lineTotal ?? item.qty * item.unitCost),
      ])
    }
  }
  return toCsv(rows)
}

export function dailySummaryCsv(reports = []) {
  const rows = [[
    'Date', 'Outlet', 'Takings', 'Cash', 'Card', 'Sales', 'Counted cash', 'Over/short',
    'Binned qty', 'Binned value', 'Waste %', 'Sell-through %', 'Balances',
  ]]
  for (const report of reports) {
    rows.push([
      report.businessDate,
      report.branchId,
      money(report.salesTotal),
      money(report.cashTotal),
      money(report.cardTotal),
      report.txCount,
      money(report.countedCash),
      money(report.overShort),
      report.wasteQty ?? 0,
      money(report.wasteValue),
      report.wastePct ?? 0,
      report.sellThroughPct ?? '',
      report.reconciles ? 'yes' : 'no',
    ])
  }
  return toCsv(rows)
}

/** Hand a generated file to the browser. */
export function downloadCsv(filename, text) {
  // The BOM is what makes Excel open a UTF-8 CSV without mangling it.
  const blob = new Blob([`﻿${text}`], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

/** First and last day of the month a date falls in, as ISO strings. */
export function monthRange(iso) {
  const [year, month] = iso.split('-').map(Number)
  const last = new Date(year, month, 0).getDate()
  const pad = (n) => String(n).padStart(2, '0')
  return { from: `${year}-${pad(month)}-01`, to: `${year}-${pad(month)}-${pad(last)}` }
}
