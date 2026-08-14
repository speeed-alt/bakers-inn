/// The handful of business constants, kept identical to `src/config.js`.
///
/// This file and the web app's config are two copies of one set of facts. If a
/// number changes on one side and not the other, the two clients will disagree
/// about what a day is or what a sale is worth — and the disagreement will show
/// up as a reconciliation error days later, not as a crash. Change both, in the
/// same commit, or change neither.
library;

/// Printed at the top of every receipt.
const String businessName = "Baker's Inn";

/// Characters across the slip in the receipt's monospace font.
const int receiptWidth = 32;

/// Pakistani Rupee. Paisa have long been out of circulation, so the rupee itself
/// is the smallest unit there is — every amount in the system is a whole number
/// of rupees, held as an integer. Never put a fractional amount in a document.
const String currencySymbol = 'Rs';
const int currencyDecimals = 0;

/// 10 ^ currencyDecimals, written out because Dart has no `**`.
const int minorUnits = 1;

/// Sales rung before this hour count towards the previous business day, so a
/// late shift that runs past midnight lands on the right day's report.
const int dayRolloverHour = 4;

/// How far a tablet's clock may be out before the app says so. Generous on
/// purpose: a couple of minutes of drift changes nothing, and a banner nobody
/// needs is a banner everybody learns to ignore.
const int clockToleranceMinutes = 5;

/// The daily cycle. An outlet orders on the evening before the day it is for;
/// the system compiles every outlet's order into one baking list at [compileHour]
/// the next morning, before the kitchen starts.
const int compileHour = 5;
const String timeZone = 'Asia/Karachi';

/// The outlet that buys, bakes and distributes. Stock sent back at the end of a
/// day goes here.
const String hubBranchId = 'MAIN';

/// How far back to look for "what did we order last `same weekday`" when
/// pre-filling an order. Bakery trade runs weekly, so the same weekday is the
/// honest comparison — a Friday is nothing like a Monday.
const int historyWeeks = 4;

/// Reasons offered when a delivery arrives short. Picked, never typed.
const List<String> shortReasons = [
  'Not enough baked',
  'Damaged in transit',
  'Miscounted',
  'Other',
];

/// Why stock is being thrown out at the end of the day.
const List<String> wasteReasons = ['Unsold', 'Stale', 'Damaged', 'Other'];

/// Customers pay in round notes, so checkout offers the exact amount plus the
/// bill rounded up to each of these.
const List<int> quickCashSteps = [100, 500, 1000, 5000];

/// Reasons offered when voiding a sale. Picked, never typed.
const List<String> voidReasons = [
  'Rung by mistake',
  'Customer changed mind',
  'Wrong item',
  'Other',
];

const List<String> roles = ['owner', 'cashier', 'specialist'];

const List<String> productCategories = [
  'Bread',
  'Bakery',
  'Cakes',
  'Savoury',
  'Other',
];
