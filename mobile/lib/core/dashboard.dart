/// The owner's screen, as arithmetic.
///
/// A port of `src/lib/dashboard.js` and `src/lib/closing.js`. Kept free of
/// Firestore and of widgets so it can be tested, and so the phone and the shop
/// tablet answer "was this day shut?" and "how much was thrown out?" identically.
library;

import 'dates.dart';
import 'materials.dart';

const int kDaysShown = 7;

/// A reopened day is an open day again.
///
/// Three screens disagreeing about this would be a nasty bug: one would refuse
/// to sell while another insisted the day was open.
bool isClosed(Map<String, dynamic>? closing) =>
    closing != null && closing['status'] != 'reopened';

int reopenCount(Map<String, dynamic>? closing) {
  final events = (closing?['events'] as List?) ?? const [];
  return events.where((e) => (e as Map)['action'] == 'reopened').length;
}

class SoldProduct {
  const SoldProduct({required this.productId, required this.name, required this.qty, required this.revenue});

  final String productId;
  final String name;
  final int qty;
  final int revenue;
}

class DaySummary {
  const DaySummary({
    required this.salesTotal,
    required this.cashTotal,
    required this.cardTotal,
    required this.txCount,
    required this.voidedCount,
    required this.byProduct,
  });

  final int salesTotal;
  final int cashTotal;
  final int cardTotal;
  final int txCount;
  final int voidedCount;

  /// Best sellers, most valuable first.
  final List<SoldProduct> byProduct;

  static const empty = DaySummary(
    salesTotal: 0,
    cashTotal: 0,
    cardTotal: 0,
    txCount: 0,
    voidedCount: 0,
    byProduct: [],
  );
}

/// One day's takings from the raw sales.
///
/// A voided sale is still a record — it is simply not money, so it is counted
/// but contributes nothing. Refunds keep their negative total, which is why
/// everything can simply be added up.
DaySummary summariseDay(List<Map<String, dynamic>> sales) {
  var salesTotal = 0;
  var cashTotal = 0;
  var cardTotal = 0;
  var txCount = 0;
  var voidedCount = 0;
  final products = <String, ({String name, int qty, int revenue})>{};

  for (final sale in sales) {
    if (sale['status'] == 'voided') {
      voidedCount += 1;
      continue;
    }
    final total = ((sale['total'] as num?) ?? 0).round();
    salesTotal += total;
    txCount += 1;
    if (sale['payment'] == 'cash') cashTotal += total;
    if (sale['payment'] == 'card') cardTotal += total;

    for (final raw in (sale['lines'] as List?) ?? const []) {
      final line = (raw as Map).cast<String, dynamic>();
      final id = (line['productId'] ?? '') as String;
      final qty = ((line['qty'] as num?) ?? 0).round();
      final price = ((line['price'] as num?) ?? 0).round();
      final entry = products[id] ??
          (name: (line['name'] ?? id) as String, qty: 0, revenue: 0);
      products[id] = (
        name: entry.name,
        qty: entry.qty + qty,
        revenue: entry.revenue + price * qty,
      );
    }
  }

  final ranked = products.entries
      .map((e) => SoldProduct(
            productId: e.key,
            name: e.value.name,
            qty: e.value.qty,
            revenue: e.value.revenue,
          ))
      .toList();
  ranked.sort((a, b) {
    final byValue = b.revenue.compareTo(a.revenue);
    return byValue != 0 ? byValue : b.qty.compareTo(a.qty);
  });

  return DaySummary(
    salesTotal: salesTotal,
    cashTotal: cashTotal,
    cardTotal: cardTotal,
    txCount: txCount,
    voidedCount: voidedCount,
    byProduct: ranked,
  );
}

class DayTakings {
  const DayTakings({required this.date, required this.isToday, required this.total});

  final String date;
  final bool isToday;
  final int total;
}

/// Takings per day across all outlets, oldest first, with today taken live.
///
/// Today comes from the sales still being rung up rather than from a closing,
/// because the closing does not exist until the shop shuts.
List<DayTakings> buildWeek(
  List<Map<String, dynamic>> closings,
  String today, {
  int todayLive = 0,
  int days = kDaysShown,
}) {
  final byDate = <String, int>{};
  for (final c in closings) {
    final date = (c['businessDate'] ?? '') as String;
    final total = ((c['salesTotal'] as num?) ?? 0).round();
    byDate[date] = (byDate[date] ?? 0) + total;
  }

  final out = <DayTakings>[];
  for (var back = days - 1; back >= 0; back -= 1) {
    final date = addDays(today, -back);
    final isToday = date == today;
    out.add(DayTakings(
      date: date,
      isToday: isToday,
      total: isToday ? todayLive : (byDate[date] ?? 0),
    ));
  }
  return out;
}

class WastedProduct {
  const WastedProduct({
    required this.productId,
    required this.productName,
    required this.qty,
    required this.value,
  });

  final String productId;
  final String productName;
  final int qty;
  final int value;
}

class WasteSummary {
  const WasteSummary({
    required this.days,
    required this.wasteQty,
    required this.wasteValue,
    required this.varianceValue,
    required this.wastePct,
    required this.sellThroughPct,
    required this.worst,
  });

  final int days;
  final int wasteQty;
  final int wasteValue;
  final int varianceValue;
  final int wastePct;

  /// Null when nothing was available to sell — no day happened, so there is no
  /// percentage to report.
  final int? sellThroughPct;
  final List<WastedProduct> worst;
}

/// Waste and sell-through across a run of days.
///
/// Read from the compiled reports rather than recomputed, so the owner's figure
/// and the one the cashier saw at closing time are the same number.
WasteSummary summariseWaste(List<Map<String, dynamic>> reports) {
  var wasteQty = 0;
  var wasteValue = 0;
  var available = 0;
  var sold = 0;
  var varianceValue = 0;
  final worst = <String, ({String name, int qty, int value})>{};

  int intOf(Object? v) => ((v as num?) ?? 0).round();

  for (final report in reports) {
    wasteQty += intOf(report['wasteQty']);
    wasteValue += intOf(report['wasteValue']);
    varianceValue += intOf(report['transferVarianceValue']);

    for (final raw in (report['byProduct'] as List?) ?? const []) {
      final row = (raw as Map).cast<String, dynamic>();
      available += intOf(row['received']) + intOf(row['carriedIn']);
      sold += intOf(row['sold']);

      final wasted = intOf(row['wasted']);
      if (wasted == 0) continue;
      final id = (row['productId'] ?? '') as String;
      final entry = worst[id] ??
          (name: (row['productName'] ?? id) as String, qty: 0, value: 0);
      worst[id] = (
        name: entry.name,
        qty: entry.qty + wasted,
        value: entry.value + intOf(row['wastedValue']),
      );
    }
  }

  final ranked = worst.entries
      .map((e) => WastedProduct(
            productId: e.key,
            productName: e.value.name,
            qty: e.value.qty,
            value: e.value.value,
          ))
      .toList();
  // Costliest first, and where two cost the same, the one there is more of.
  ranked.sort((a, b) {
    final byValue = b.value.compareTo(a.value);
    return byValue != 0 ? byValue : b.qty.compareTo(a.qty);
  });

  return WasteSummary(
    days: reports.length,
    wasteQty: wasteQty,
    wasteValue: wasteValue,
    varianceValue: varianceValue,
    wastePct: available > 0 ? (wasteQty / available * 100).round() : 0,
    sellThroughPct: available > 0 ? (sold / available * 100).round() : null,
    worst: ranked,
  );
}

class Problem {
  const Problem({required this.what, required this.where, this.count = 1});

  final String what;
  final String where;

  /// How many outlets this same problem covers. The web app lists one row per
  /// outlet; on a phone that turns three shops into three near-identical lines,
  /// so identical problems are folded together and counted instead.
  final int count;
}

/// The short list of things that are actually wrong.
///
/// Deliberately capped: a dashboard that always shows five warnings teaches its
/// owner to ignore warnings. Only things someone can act on today belong here.
List<Problem> findProblems({
  required String today,
  List<Map<String, dynamic>> branches = const [],
  List<Map<String, dynamic>> closings = const [],
  List<Map<String, dynamic>> transfers = const [],
  Map<String, dynamic>? order,
  List<MaterialItem> materials = const [],
  String Function(String)? nameOf,
  int max = 6,
}) {
  final name = nameOf ?? (x) => x;
  final problems = <Problem>[];
  final yesterday = previousDate(today);

  for (final c in closings) {
    if (c['businessDate'] == today && !isClosed(c)) {
      final by = (c['reopenedByName'] ?? 'staff') as String;
      final reason = c['reopenReason'] as String?;
      problems.add(Problem(
        what: 'A day that was closed has been reopened',
        where: '${name((c['branchId'] ?? '') as String)} · reopened by $by'
            '${reason != null ? ' — $reason' : ''}',
      ));
    }
  }

  // Folded rather than listed per outlet: on a phone, three shops that all
  // failed to count yesterday is one fact, not three.
  final uncounted = <String>[];
  for (final branch in branches) {
    final id = (branch['id'] ?? '') as String;
    final closed = closings.any((c) =>
        c['businessDate'] == yesterday && c['branchId'] == id && isClosed(c));
    if (!closed) uncounted.add((branch['name'] ?? id) as String);
  }
  if (uncounted.isNotEmpty) {
    problems.add(Problem(
      what: uncounted.length == 1
          ? 'Yesterday was never counted'
          : 'Yesterday was never counted at ${uncounted.length} outlets',
      where: '${uncounted.join(', ')} · the tills there are blocked until it is',
      count: uncounted.length,
    ));
  }

  for (final t in transfers) {
    final to = name((t['toBranchId'] ?? '') as String);
    final ref = (t['ref'] ?? '') as String;
    if (t['status'] == 'dispatched') {
      problems.add(Problem(
        what: 'A delivery has not been confirmed',
        where: '$to · sent as $ref',
      ));
    }
    for (final raw in (t['items'] as List?) ?? const []) {
      final item = (raw as Map).cast<String, dynamic>();
      final sent = ((item['qtySent'] as num?) ?? 0).round();
      final received = item['qtyReceived'] as num?;
      if (received == null) continue;
      final missing = sent - received.round();
      if (missing <= 0) continue;
      problems.add(Problem(
        what: '$missing × ${item['productName']} did not arrive',
        where: '$to · ${item['shortReason'] ?? 'no reason given'} · $ref',
      ));
    }
  }

  final missingOrders = (order?['missing'] as List?) ?? const [];
  if (missingOrders.isNotEmpty) {
    problems.add(Problem(
      what: 'An outlet has no order and no history to fall back on',
      where: '${missingOrders.map((b) => name(b as String)).join(', ')}'
          ' · nothing was baked for them',
    ));
  }

  for (final material in lowStock(materials)) {
    final days = daysOfStock(material);
    final left = _tidy(material.onHand);
    problems.add(Problem(
      what: '${material.name} is running out',
      where: days == null
          ? '$left ${material.unit} left · under the level you set'
          : '$left ${material.unit} left · about ${days.floor()} '
              'day${days.floor() == 1 ? '' : 's'} at the current rate',
    ));
  }

  return problems.take(max).toList();
}

/// 8 rather than 8.0, but 8.5 kept. Quantities are read at a glance and a
/// trailing zero is noise.
String _tidy(double value) =>
    value == value.roundToDouble() ? '${value.round()}' : '$value';
