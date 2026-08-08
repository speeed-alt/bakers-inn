/// Raw materials — flour, butter, boxes — kept as a plain ledger rather than a
/// recipe engine. Three things happen to a material: some arrives, somebody
/// counts what is really there, or some goes bad. Everything the owner wants to
/// know is worked out from those three.
///
/// A direct port of `src/lib/materials.js`. The two must agree: the owner
/// reading "8 days left" on his phone and the same figure on the shop tablet is
/// the whole point, and a shop that reorders on the wrong number loses money.
/// `test/port_test.dart` pins these against values taken from the web app.
library;

const String kReceived = 'received';
const String kCount = 'count';
const String kSpoilage = 'spoilage';

/// How much stock a movement leaves behind.
///
/// A count is the odd one out: the person counting types what is *there*, not a
/// difference, so it replaces the figure rather than adjusting it. Making the
/// human do that subtraction is exactly how stock records start lying.
double applyMovement(double onHand, {required String type, double qty = 0}) {
  if (type == kCount) return qty < 0 ? 0 : qty;
  if (type == kSpoilage) {
    final left = onHand - qty;
    return left < 0 ? 0 : left;
  }
  return onHand + qty;
}

class MaterialItem {
  const MaterialItem({
    required this.id,
    required this.name,
    required this.unit,
    this.onHand = 0,
    this.reorderLevel = 0,
    this.usagePerDay,
    this.costPerUnit = 0,
    this.active = true,
  });

  final String id;
  final String name;
  final String unit;
  final double onHand;
  final double reorderLevel;

  /// Derived from two consecutive counts, not from recipes. Null until the shop
  /// has counted the same material twice.
  final double? usagePerDay;
  final double costPerUnit;
  final bool active;

  factory MaterialItem.fromMap(String id, Map<String, dynamic> m) {
    double num_(Object? v) => (v as num?)?.toDouble() ?? 0;
    final perDay = m['usagePerDay'] as num?;
    return MaterialItem(
      id: id,
      name: (m['name'] ?? id) as String,
      unit: (m['unit'] ?? '') as String,
      onHand: num_(m['onHand']),
      reorderLevel: num_(m['reorderLevel']),
      usagePerDay: perDay?.toDouble(),
      costPerUnit: num_(m['costPerUnit']),
      active: m['active'] != false,
    );
  }
}

class Usage {
  const Usage({required this.used, required this.days, required this.perDay});

  final double used;
  final double days;
  final double perDay;
}

/// Work out daily usage from two counts.
///
/// Between one count and the next, whatever arrived and did not survive was
/// used: `(previous count + received since − spoiled since) − counted now`. No
/// recipes needed — the shelf tells the truth, which is the whole reason the
/// design avoided ingredient-level tracking.
///
/// Returns null rather than a negative figure when there is more on the shelf
/// than can be explained. That means a delivery went unrecorded, and inventing a
/// usage rate from it would poison every "days left" figure that follows.
Usage? usageBetweenCounts({
  double? previousCount,
  double receivedSince = 0,
  double spoiledSince = 0,
  required double countedNow,
  double? days,
}) {
  if (previousCount == null || days == null || days <= 0) return null;
  final used = previousCount + receivedSince - spoiledSince - countedNow;
  if (used < 0) return null;
  return Usage(used: used, days: days, perDay: used / days);
}

/// Whole rupees. Each line is rounded as it is added, matching the web app —
/// a purchase line is a real amount on a real invoice.
int purchaseTotal(Iterable<({double qty, double unitCost})> items) =>
    items.fold(0, (running, i) => running + (i.qty * i.unitCost).round());

/// Days of stock left at the current rate. Null when usage is not known yet.
double? daysOfStock(MaterialItem material) {
  final perDay = material.usagePerDay;
  if (perDay == null || perDay <= 0) return null;
  return material.onHand / perDay;
}

/// Low when it will run out before the next delivery can realistically arrive,
/// or when it has fallen under the level the owner set for it.
bool isLow(MaterialItem material, {double leadDays = 2}) {
  if (material.reorderLevel > 0 && material.onHand <= material.reorderLevel) {
    return true;
  }
  final days = daysOfStock(material);
  return days != null && days <= leadDays;
}

/// Whole rupees. The sum is rounded once at the end rather than per line, which
/// is what the web app does — rounding each line first would drift.
int stockValue(List<MaterialItem> materials) {
  var total = 0.0;
  for (final m in materials) {
    total += m.onHand * m.costPerUnit;
  }
  return total.round();
}

List<MaterialItem> lowStock(List<MaterialItem> materials, {double leadDays = 2}) {
  final low = materials
      .where((m) => m.active && isLow(m, leadDays: leadDays))
      .toList();
  // Soonest to run out first. A material with no usage figure sorts as 0, which
  // puts "under the level you set" above "about 5 days left" — correct, because
  // the first is a fact and the second is an estimate.
  low.sort((a, b) => (daysOfStock(a) ?? 0).compareTo(daysOfStock(b) ?? 0));
  return low;
}

class GrossMargin {
  const GrossMargin({
    required this.salesTotal,
    required this.materialCost,
    required this.wasteValue,
    required this.margin,
    required this.marginPct,
  });

  final int salesTotal;
  final int materialCost;
  final int wasteValue;
  final int margin;

  /// Null rather than zero when nothing was sold — "0%" would read as a
  /// catastrophic day rather than as no day at all.
  final int? marginPct;
}

/// Gross margin for the business as a whole.
///
/// Deliberately not per outlet: without recipes there is no honest way to say
/// what a shop's stock cost, and an invented figure is worse than none. Waste is
/// subtracted at what it would have sold for — money that was there and is not.
GrossMargin grossMargin({
  int salesTotal = 0,
  int materialCost = 0,
  int wasteValue = 0,
}) {
  final margin = salesTotal - materialCost - wasteValue;
  return GrossMargin(
    salesTotal: salesTotal,
    materialCost: materialCost,
    wasteValue: wasteValue,
    margin: margin,
    marginPct: salesTotal > 0 ? (margin / salesTotal * 100).round() : null,
  );
}
