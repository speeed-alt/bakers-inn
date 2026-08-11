// Single place for the handful of business constants.

// Printed at the top of every receipt.
export const BUSINESS_NAME = "The Baker's Inn"

// Characters across the slip in the receipt's monospace font.
export const RECEIPT_WIDTH = 32

// What receipts are printed on. This sets the page size, margins and type size
// together so the slip comes out right at 100% — nobody should have to touch
// the scale or margins in the print dialog.
// Each option fills the width of its paper, so the type is larger on bigger
// sheets — about 11pt on a roll, 19pt on A5, 27pt on A4.
//   '80mm' — thermal till roll, the usual point-of-sale printer
//   'a5'   — half sheet on an ordinary printer
//   'a4'   — full sheet
export const RECEIPT_PAPER = 'a5'

// Pakistani Rupee. Paisa have long been out of circulation, so the rupee itself
// is the smallest unit there is — every amount in the system is a whole number
// of rupees, held as an integer. To move to a currency with subunits, set
// CURRENCY_DECIMALS to 2; nothing else needs to change.
export const CURRENCY_SYMBOL = 'Rs'
export const CURRENCY_DECIMALS = 0
export const MINOR_UNITS = 10 ** CURRENCY_DECIMALS

// Sales rung before this hour count towards the previous business day, so a
// late shift that runs past midnight lands on the right day's report.
export const DAY_ROLLOVER_HOUR = 4

// How far a tablet's clock may be out before the app says so. Generous on
// purpose: a couple of minutes of drift changes nothing, and a banner nobody
// needs is a banner everybody learns to ignore.
export const CLOCK_TOLERANCE_MINUTES = 5

// The daily cycle. An outlet orders on the evening before the day it is for;
// the system compiles every outlet's order into one baking list at COMPILE_HOUR
// the next morning, before the kitchen starts.
export const COMPILE_HOUR = 5
export const TIME_ZONE = 'Asia/Karachi'

// The outlet that buys, bakes and distributes. Stock sent back at the end of a
// day goes here. Set once when the outlets are created.
export const HUB_BRANCH_ID = 'MAIN'

// How far back to look for "what did we order last <same weekday>" when
// pre-filling an order. Bakery trade runs weekly, so the same weekday is the
// honest comparison — a Friday is nothing like a Monday.
export const HISTORY_WEEKS = 4

// Reasons offered when a delivery arrives short. Picked, never typed.
export const SHORT_REASONS = ['Not enough baked', 'Damaged in transit', 'Miscounted', 'Other']

// Why stock is being thrown out at the end of the day.
export const WASTE_REASONS = ['Unsold', 'Stale', 'Damaged', 'Other']

// Customers pay in round notes, so checkout offers the exact amount plus the
// bill rounded up to each of these. A Rs 1,080 bill becomes 1,100 / 1,500 /
// 2,000 / 5,000 — the amounts actually handed across the counter.
export const QUICK_CASH_STEPS = [100, 500, 1000, 5000]

// Reasons offered when voiding a sale. Picked, never typed.
export const VOID_REASONS = ['Rung by mistake', 'Customer changed mind', 'Wrong item', 'Other']

export const ROLES = ['owner', 'cashier', 'specialist']

// What the business spends besides ingredients. Salaries are their own kind
// because they are per person and per month rather than per bill.
export const UTILITY_CATEGORIES = [
  'Electricity',
  'Gas',
  'Water',
  'Internet',
  'Rent',
  'Repairs',
  'Transport',
  'Other',
]

export const PRODUCT_CATEGORIES = ['Bread', 'Bakery', 'Cakes', 'Savoury', 'Other']
