/// What the owner wants on his phone is not a pile of numbers — it is the answer
/// to two questions: how much did we take, and is anything wrong today. So the
/// takings come first, then anything that needs him, then the state of today's
/// cycle. Everything else is detail below the fold.
///
/// Reads only. Nothing on this screen can change a record, which is what makes
/// it safe to open in a car.
library;

import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';

import '../core/dashboard.dart';
import '../core/dates.dart';
import '../core/materials.dart';
import '../core/money.dart';
import '../theme.dart';
import '../widgets/shell.dart';

class DashboardScreen extends StatefulWidget {
  const DashboardScreen({super.key});

  @override
  State<DashboardScreen> createState() => _DashboardScreenState();
}

class _DashboardScreenState extends State<DashboardScreen> {
  late final _Feeds _feeds = _Feeds(businessDateOf());

  @override
  void dispose() {
    _feeds.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: _feeds,
      builder: (context, _) {
        if (_feeds.error != null) {
          return ListView(
            padding: const EdgeInsets.all(20),
            children: [ProblemNote(message: '${_feeds.error}')],
          );
        }
        if (_feeds.loading) {
          return const LoadingNote(text: "Reading today's takings…");
        }
        return _Body(feeds: _feeds);
      },
    );
  }
}

class _Body extends StatelessWidget {
  const _Body({required this.feeds});

  final _Feeds feeds;

  @override
  Widget build(BuildContext context) {
    final today = feeds.today;
    final colors = context.colors;

    String nameOf(String id) {
      for (final b in feeds.branches) {
        if (b['id'] == id) return (b['name'] ?? id) as String;
      }
      return id;
    }

    final overall = summariseDay(feeds.sales);
    final week = buildWeek(feeds.closings, today, todayLive: overall.salesTotal);
    final weekTotal = week.fold(0, (running, d) => running + d.total);
    final tradingDays = week.where((d) => d.total > 0).length;

    final materials = [
      for (final m in feeds.materials)
        MaterialItem.fromMap((m['id'] ?? '') as String, m),
    ];

    final problems = findProblems(
      today: today,
      branches: feeds.branches,
      closings: feeds.closings,
      transfers: feeds.transfers,
      order: feeds.order,
      materials: materials,
      nameOf: nameOf,
    );

    // Every report is a finished day — one is only written when an outlet
    // closes — so today's counts as soon as the first shop shuts, which is
    // exactly when he wants to see what went in the bin.
    final recentReports = feeds.reports.take(21).toList();
    final waste = summariseWaste(recentReports);

    final from = week.first.date;
    final to = week.last.date;
    bool inWindow(Object? date) =>
        date is String && date.compareTo(from) >= 0 && date.compareTo(to) <= 0;

    final materialCost = feeds.purchases
        .where((p) => inWindow(p['businessDate']))
        .fold(0, (running, p) => running + ((p['total'] as num?) ?? 0).round());
    final wastedValue = feeds.reports
        .where((r) => inWindow(r['businessDate']))
        .fold(0, (running, r) => running + ((r['wasteValue'] as num?) ?? 0).round());
    final margin = grossMargin(
      salesTotal: weekTotal,
      materialCost: materialCost,
      wasteValue: wastedValue,
    );

    final perBranch = <String, DaySummary>{};
    for (final branch in feeds.branches) {
      final id = (branch['id'] ?? '') as String;
      perBranch[id] = summariseDay(
        feeds.sales.where((s) => s['branchId'] == id).toList(),
      );
    }

    final faults = feeds.faults
        .where((f) => ((f['businessDate'] ?? '') as String)
            .compareTo(addDays(today, -3)) >= 0)
        .take(6)
        .toList();

    return RefreshIndicator(
      // Firestore streams update on their own, so this exists for reassurance
      // rather than for data: an owner who has just been told something by
      // phone will pull to check, and finding nothing to pull is unsettling.
      onRefresh: feeds.refresh,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(20, 20, 20, 40),
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Expanded(child: Text('Today', style: context.type.titleLarge)),
              Text(formatDate(today),
                  style: TextStyle(fontSize: 13, color: colors.muted)),
            ],
          ),
          const SizedBox(height: 12),
          StatGrid(stats: [
            (label: 'Takings', value: formatMoney(overall.salesTotal)),
            (label: 'Sales', value: '${overall.txCount}'),
            (label: 'Cash', value: formatMoney(overall.cashTotal)),
            (label: 'Card', value: formatMoney(overall.cardTotal)),
            (label: 'Week so far', value: formatMoney(weekTotal)),
            (
              label: 'Day average',
              value: formatMoney(
                  weekTotal ~/ (tradingDays == 0 ? 1 : tradingDays)),
            ),
          ]),

          if (problems.isNotEmpty) ...[
            const SizedBox(height: 26),
            const SectionTitle('Needs a look'),
            Panel(children: [
              for (final p in problems)
                PanelLine(left: p.what, detail: p.where),
            ]),
          ],

          if (faults.isNotEmpty) ...[
            const SizedBox(height: 26),
            const SectionTitle('Tablets reporting trouble',
                aside: 'last 3 days'),
            Panel(children: [
              for (final f in faults)
                PanelLine(
                  left: '${nameOf((f['branchId'] ?? '') as String)}'
                      ' · till ${f['device'] ?? '?'}',
                  detail: '${formatDate((f['businessDate'] ?? today) as String)}'
                      ' · ${f['message'] ?? ''}',
                ),
            ]),
            const SizedBox(height: 8),
            Text(
              'The tablet recovered on its own — no sales are lost. If the same '
              'outlet keeps appearing, that screen needs looking at.',
              style: TextStyle(fontSize: 13, color: colors.muted, height: 1.45),
            ),
          ],

          const SizedBox(height: 26),
          const SectionTitle("Today's round"),
          _TodaysRound(feeds: feeds, nameOf: nameOf),

          const SizedBox(height: 26),
          SectionTitle('Last ${week.length} days'),
          _Week(week: week),

          const SizedBox(height: 26),
          if (recentReports.isEmpty) ...[
            const SectionTitle('Waste'),
            const Panel(children: [
              EmptyNote(
                'Nothing yet. Waste figures appear once outlets have counted '
                'their leftovers at closing.',
              ),
            ]),
          ] else ...[
            SectionTitle(
              'Waste and sell-through',
              aside: 'last ${_dayCount(recentReports)} closed',
            ),
            StatGrid(stats: [
              (label: 'Thrown out', value: formatMoney(waste.wasteValue)),
              (label: 'Waste rate', value: '${waste.wastePct}%'),
              (
                label: 'Sell-through',
                value: waste.sellThroughPct == null
                    ? '—'
                    : '${waste.sellThroughPct}%'
              ),
              (label: 'Lost in transit', value: formatMoney(waste.varianceValue)),
            ]),
            if (waste.worst.isNotEmpty) ...[
              const SizedBox(height: 14),
              const SectionTitle('Costing the most'),
              Panel(children: [
                for (final w in waste.worst.take(6))
                  PanelLine(
                    left: w.productName,
                    detail: '${w.qty} binned',
                    right: formatMoney(w.value),
                  ),
              ]),
              const SizedBox(height: 8),
              Text(
                'Sell-through near 100% can mean selling out early — worth '
                'baking more, not less.',
                style: TextStyle(fontSize: 13, color: colors.muted, height: 1.45),
              ),
            ],
          ],

          const SizedBox(height: 26),
          SectionTitle('Gross margin', aside: 'last ${week.length} days'),
          Panel(children: [
            PanelLine(left: 'Takings', right: formatMoney(margin.salesTotal)),
            PanelLine(
                left: 'Less materials bought',
                right: '−${formatMoney(margin.materialCost)}'),
            PanelLine(
                left: 'Less thrown out',
                right: '−${formatMoney(margin.wasteValue)}'),
            PanelLine(
              left: 'Gross margin',
              strong: true,
              right: formatMoney(margin.margin),
              note: margin.marginPct == null ? null : '${margin.marginPct}%',
              noteIsAlert: margin.margin < 0,
            ),
          ]),
          const SizedBox(height: 8),
          Text(
            'For the business as a whole, not per outlet — without recipes there '
            'is no honest way to say what one shop\'s stock cost. Materials are '
            'counted when bought, not when used, so a big delivery makes one '
            'week look worse and the next look better.',
            style: TextStyle(fontSize: 13, color: colors.muted, height: 1.45),
          ),

          const SizedBox(height: 26),
          const SectionTitle('By outlet today'),
          Panel(children: [
            for (final entry in perBranch.entries)
              PanelLine(
                left: nameOf(entry.key),
                detail: '${entry.value.txCount} sales · '
                    'cash ${formatMoney(entry.value.cashTotal)} · '
                    'card ${formatMoney(entry.value.cardTotal)}'
                    '${entry.value.voidedCount > 0 ? ' · ${entry.value.voidedCount} voided' : ''}',
                right: formatMoney(entry.value.salesTotal),
              ),
          ]),

          if (overall.byProduct.isNotEmpty) ...[
            const SizedBox(height: 26),
            const SectionTitle('Best sellers today'),
            Panel(children: [
              for (final p in overall.byProduct.take(8))
                PanelLine(
                  left: p.name,
                  detail: '${p.qty} sold',
                  right: formatMoney(p.revenue),
                ),
            ]),
          ],

          const SizedBox(height: 26),
          const SectionTitle('Recent closes'),
          Panel(children: [
            if (feeds.closings.isEmpty)
              const EmptyNote('No days closed yet.')
            else
              for (final c in feeds.closings.take(12))
                Builder(builder: (context) {
                  final reopens = reopenCount(c);
                  final over = ((c['overShort'] as num?) ?? 0).round();
                  return PanelLine(
                    left: formatDate((c['businessDate'] ?? '') as String),
                    detail: [
                      nameOf((c['branchId'] ?? '') as String),
                      if (c['status'] != 'closed') '${c['status']}',
                      if (reopens > 0)
                        'reopened $reopens× · last by ${c['reopenedByName'] ?? 'staff'}',
                    ].join(' · '),
                    right: formatMoney(((c['salesTotal'] as num?) ?? 0).round()),
                    // Over or short is the one figure here allowed to be red,
                    // and only when it is not zero.
                    note: over == 0 ? null : formatMoney(over),
                    noteIsAlert: over != 0,
                  );
                }),
          ]),
        ],
      ),
    );
  }

  int _dayCount(List<Map<String, dynamic>> reports) =>
      reports.map((r) => r['businessDate']).toSet().length;
}

/// Where today's cycle has got to: one line per step.
class _TodaysRound extends StatelessWidget {
  const _TodaysRound({required this.feeds, required this.nameOf});

  final _Feeds feeds;
  final String Function(String) nameOf;

  @override
  Widget build(BuildContext context) {
    final order = feeds.order;
    final expected = feeds.branches.isEmpty ? 3 : feeds.branches.length;
    final ordersIn =
        feeds.demands.where((d) => d['status'] != 'draft').length;

    final out =
        feeds.transfers.where((t) => t['direction'] != 'return').toList();
    final sent = out.where((t) => t['status'] != 'draft').length;
    final received = out.where((t) => t['status'] == 'received').length;
    final progress = _progress(order);

    final steps = <({bool done, String what, String detail})>[
      (
        done: ordersIn >= expected,
        what: 'Outlets ordered',
        detail: '$ordersIn of $expected'
      ),
      (
        done: order != null,
        what: 'Baking list made',
        detail: order == null ? 'waiting for 5am' : '${order['ref'] ?? ''}'
      ),
      (
        done: order != null && order['status'] == 'done',
        what: 'Baked',
        detail: order == null ? '—' : '${progress.made} of ${progress.needed}'
      ),
      (
        done: out.isNotEmpty && sent == out.length,
        what: 'Delivered out',
        detail: out.isEmpty ? 'nothing to send' : '$sent of ${out.length}'
      ),
      (
        done: out.isNotEmpty && received == out.length,
        what: 'Confirmed by outlets',
        detail: out.isEmpty ? '—' : '$received of ${out.length}'
      ),
    ];

    final colors = context.colors;
    return Panel(children: [
      for (final step in steps)
        PanelLine(
          left: step.what,
          note: step.detail,
          leading: Icon(
            step.done ? Icons.check_circle : Icons.circle_outlined,
            size: 18,
            color: step.done ? colors.ink : colors.muted,
          ),
        ),
    ]);
  }

  /// How much of the baking list actually came out of the oven.
  ///
  /// Written defensively: the kitchen's tally lives in its own `produced` map
  /// (the security rules depend on that separation), and a shape this screen
  /// does not recognise should show nothing rather than crash the owner's
  /// dashboard.
  ({int made, int needed}) _progress(Map<String, dynamic>? order) {
    if (order == null) return (made: 0, needed: 0);
    final produced =
        (order['produced'] as Map?)?.cast<String, dynamic>() ?? const {};
    var needed = 0;
    var made = 0;
    for (final raw in (order['items'] as List?) ?? const []) {
      final item = (raw as Map).cast<String, dynamic>();
      needed += ((item['qty'] as num?) ?? 0).round();
      made += ((produced[item['productId']] as num?) ?? 0).round();
    }
    return (made: made, needed: needed);
  }
}

/// Takings over the last week, as bars.
class _Week extends StatelessWidget {
  const _Week({required this.week});

  final List<DayTakings> week;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    final peak = week.fold(1, (m, d) => d.total > m ? d.total : m);

    return Panel(children: [
      Padding(
        padding: const EdgeInsets.symmetric(horizontal: 15, vertical: 14),
        child: Column(
          children: [
            for (final day in week)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 5),
                child: Row(
                  children: [
                    SizedBox(
                      width: 44,
                      child: Text(
                        day.isToday
                            ? 'Today'
                            : formatDate(day.date).split(',').first,
                        style: TextStyle(
                          fontSize: 13,
                          color: day.isToday ? null : colors.muted,
                          fontWeight:
                              day.isToday ? FontWeight.w600 : FontWeight.w400,
                        ),
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: ClipRRect(
                        borderRadius: BorderRadius.circular(3),
                        child: LinearProgressIndicator(
                          value: day.total / peak,
                          minHeight: 16,
                          backgroundColor: colors.surface2,
                          valueColor: AlwaysStoppedAnimation(
                            colors.ink.withValues(alpha: day.isToday ? 1 : 0.7),
                          ),
                        ),
                      ),
                    ),
                    const SizedBox(width: 10),
                    SizedBox(
                      width: 72,
                      child: Text(
                        day.total == 0
                            ? '—'
                            : formatMoney(day.total, symbol: false),
                        textAlign: TextAlign.right,
                        style: const TextStyle(
                          fontSize: 13,
                          fontFeatures: [FontFeature.tabularFigures()],
                        ),
                      ),
                    ),
                  ],
                ),
              ),
          ],
        ),
      ),
    ]);
  }
}

/// Everything the dashboard reads, in one place.
///
/// Eight collections behind one listener rather than eight nested
/// `StreamBuilder`s, which would rebuild the whole screen eight times on the
/// first frame and indent the code past readability.
class _Feeds extends ChangeNotifier {
  _Feeds(this.today) {
    _subscribe();
  }

  final String today;
  final List<StreamSubscription<QuerySnapshot<Map<String, dynamic>>>> _subs = [];
  StreamSubscription<DocumentSnapshot<Map<String, dynamic>>>? _orderSub;

  List<Map<String, dynamic>> branches = const [];
  List<Map<String, dynamic>> sales = const [];
  List<Map<String, dynamic>> closings = const [];
  List<Map<String, dynamic>> transfers = const [];
  List<Map<String, dynamic>> demands = const [];
  List<Map<String, dynamic>> reports = const [];
  List<Map<String, dynamic>> materials = const [];
  List<Map<String, dynamic>> purchases = const [];
  List<Map<String, dynamic>> faults = const [];
  Map<String, dynamic>? order;

  Object? error;

  /// The screen draws as soon as the figures at the top can be trusted. Waiting
  /// for all eight would hold a blank screen on the slowest one — usually the
  /// month of purchases, which only feeds a panel far below the fold.
  bool get loading => _pending.contains('branches') || _pending.contains('sales');
  final Set<String> _pending = {
    'branches',
    'sales',
    'closings',
    'transfers',
    'demands',
    'reports',
    'materials',
    'purchases',
    'faults',
    'order',
  };

  static List<Map<String, dynamic>> _rows(
      QuerySnapshot<Map<String, dynamic>> snap) {
    return snap.docs.map((d) => {'id': d.id, ...d.data()}).toList();
  }

  void _listen(
    String key,
    Query<Map<String, dynamic>> query,
    void Function(List<Map<String, dynamic>>) assign,
  ) {
    _subs.add(query.snapshots().listen(
      (snap) {
        assign(_rows(snap));
        _pending.remove(key);
        notifyListeners();
      },
      onError: (Object e) {
        // A denied read looks exactly like an empty day unless it is said out
        // loud. Only the two feeds the screen cannot draw without are fatal;
        // the rest simply leave their panel empty.
        if (key == 'branches' || key == 'sales') error = e;
        _pending.remove(key);
        notifyListeners();
      },
    ));
  }

  void _subscribe() {
    final db = FirebaseFirestore.instance;

    _listen('branches', db.collection('branches'), (r) => branches = r);
    _listen(
      'sales',
      db.collection('sales').where('businessDate', isEqualTo: today),
      (r) => sales = r,
    );
    _listen(
      'closings',
      db.collection('closings').orderBy('businessDate', descending: true).limit(30),
      (r) => closings = r,
    );
    _listen(
      'transfers',
      db.collection('transfers').where('businessDate', isEqualTo: today),
      (r) => transfers = r,
    );
    _listen(
      'demands',
      db.collection('demands').where('businessDate', isEqualTo: today),
      (r) => demands = r,
    );
    _listen(
      'reports',
      db.collection('dailyReports').orderBy('businessDate', descending: true).limit(40),
      (r) => reports = r,
    );
    _listen('materials', db.collection('rawMaterials'), (r) => materials = r);
    _listen(
      'purchases',
      db.collection('purchases').orderBy('businessDate', descending: true).limit(60),
      (r) => purchases = r,
    );
    _listen(
      'faults',
      db.collection('clientErrors').orderBy('at', descending: true).limit(20),
      (r) => faults = r,
    );

    // The day's baking list is a natural key, so it is fetched by id rather
    // than searched for — see core/ids.dart.
    _orderSub = db
        .collection('productionOrders')
        .doc('PO-${compactDate(today)}')
        .snapshots()
        .listen(
      (snap) {
        order = snap.exists ? {'id': snap.id, ...?snap.data()} : null;
        _pending.remove('order');
        notifyListeners();
      },
      onError: (Object _) {
        _pending.remove('order');
        notifyListeners();
      },
    );
  }

  /// Firestore is already live, so this only has to give the gesture something
  /// to settle on.
  Future<void> refresh() async {
    await Future<void>.delayed(const Duration(milliseconds: 400));
  }

  @override
  void dispose() {
    for (final sub in _subs) {
      sub.cancel();
    }
    _orderSub?.cancel();
    super.dispose();
  }
}
