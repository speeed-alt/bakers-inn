import { receiptText } from '../lib/receipt.js'

export default function Receipt({ sale, branchName }) {
  return <div className="receipt">{receiptText(sale, branchName)}</div>
}
