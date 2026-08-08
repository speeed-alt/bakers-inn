/// The owner's arithmetic, pinned.
///
/// Every expected value here was worked out from `src/lib/dashboard.js`,
/// `src/lib/materials.js` and `src/lib/closing.js` — the web app's own rules.
/// If a change makes one of these fail, the phone and the shop tablet have
/// started disagreeing about the same day's money, which is the one failure
/// nobody would spot by looking.
library;

import 'package:bakers_inn/core/dashboard.dart';
import 'package:bakers_inn/core/materials.dart';
import 'package:flutter_test/flutter_test.dart';

MaterialItem material({
  double onHand = 0,
  double reorderLevel = 0,
  double? usagePerDay,
  double costPerUnit = 0,
  bool active = true,
}) =>
    MaterialItem(
      id: 'flour',
      name: 'Flour',
      unit: 'kg',
      onHand: onHand,
      reorderLevel: reorderLevel,
      usagePerDay: usagePerDay,
      costPerUnit: costPerUnit,
      active: active,
    );

void main() {
  group('a day is shut unless somebody reopened it', () {
    test('no closing at all means the day is open', () {
      expect(isClosed(null), isFalse);
    });

    test('a reopened day is an open day again', () {
      expect(isClosed({'status': 'closed'}), isTrue);
      expect(isClosed({'status': 'reopened'}), isFalse);
    });

    test('reopens are counted from the event trail, not a flag', () {
      final closing = {
        'events': [
          {'action': 'closed'},
          {'action': 'reopened'},
          {'action': 'closed'},
          {'action': 'reopened'},
        ],
      };
      expect(reopenCount(closing), 2);
      expect(reopenCount(null), 0);
    });
  });

  group('a movement leaves the right amount behind', () {
    test('a count replaces the figure rather than adjusting it', () {
      expect(applyMovement(40, type: kCount, qty: 12), 12);
    });

    test('spoilage subtracts, and never below zero', () {
      expect(applyMovement(10, type: kSpoilage, qty: 3), 7);
      expect(applyMovement(2, type: kSpoilage, qty: 9), 0);
    });

    test('anything else adds', () {
      expect(applyMovement(10, type: kReceived, qty: 5), 15);
    });
  });

  group('running out', () {
    test('under the reorder level is low whatever the rate', () {
      expect(isLow(material(onHand: 5, reorderLevel: 10)), isTrue);
    });

    test('above the level but running out within lead time is also low', () {
      // 3 kg at 2 kg a day is a day and a half — less than the two days a
      // delivery takes, so it is low even though the level says otherwise.
      expect(isLow(material(onHand: 3, reorderLevel: 1, usagePerDay: 2)), isTrue);
    });

    test('plenty, and used slowly, is not low', () {
      expect(isLow(material(onHand: 40, reorderLevel: 10, usagePerDay: 2)), isFalse);
    });

    test('days left is unknown until the same material is counted twice', () {
      expect(daysOfStock(material(onHand: 30)), isNull);
      expect(daysOfStock(material(onHand: 30, usagePerDay: 0)), isNull);
      expect(daysOfStock(material(onHand: 30, usagePerDay: 6)), 5);
    });

    test('a material turned off is never chased', () {
      final off = material(onHand: 0, reorderLevel: 10, active: false);
      expect(lowStock([off]), isEmpty);
    });

    test('stock is worth the sum of its lines, rounded once', () {
      expect(
        stockValue([
          material(onHand: 2.5, costPerUnit: 181),
          material(onHand: 1.5, costPerUnit: 161),
        ]),
        // 452.5 + 241.5 = 694 exactly; rounding each line first would give 695.
        694,
      );
    });
  });

  group('usage between two counts', () {
    test('is what went in less what is still there, over the days between', () {
      // 50 on the shelf, 10 arrived, 30 left five days later: 30 used, 6 a day.
      final usage = usageBetweenCounts(
        previousCount: 50,
        receivedSince: 10,
        countedNow: 30,
        days: 5,
      );
      expect(usage!.used, 30);
      expect(usage.perDay, 6);
    });

    test('spoilage is taken out, because it was not used', () {
      final usage = usageBetweenCounts(
        previousCount: 50,
        receivedSince: 10,
        spoiledSince: 5,
        countedNow: 30,
        days: 5,
      );
      expect(usage!.used, 25);
    });

    test('refuses rather than inventing a rate when a delivery went unrecorded',
        () {
      // More on the shelf than can be explained. A negative "used" would poison
      // every days-left figure that followed.
      expect(
        usageBetweenCounts(previousCount: 10, countedNow: 40, days: 5),
        isNull,
      );
    });

    test('needs a previous count and a real gap', () {
      expect(usageBetweenCounts(countedNow: 10, days: 5), isNull);
      expect(usageBetweenCounts(previousCount: 50, countedNow: 10, days: 0), isNull);
      expect(usageBetweenCounts(previousCount: 50, countedNow: 10), isNull);
    });
  });

  group('a purchase total', () {
    test('rounds each line, the way an invoice does', () {
      expect(
        purchaseTotal([
          (qty: 2.5, unitCost: 181),   // 452.5 -> 453
          (qty: 1.5, unitCost: 161),   // 241.5 -> 242
        ]),
        695,
      );
    });

    test('is nothing when there are no lines', () {
      expect(purchaseTotal([]), 0);
    });
  });

  group('gross margin', () {
    test('is takings less what was bought and what was binned', () {
      final m = grossMargin(salesTotal: 10000, materialCost: 4000, wasteValue: 1000);
      expect(m.margin, 5000);
      expect(m.marginPct, 50);
    });

    test('reports no percentage rather than 0% on a day with no takings', () {
      expect(grossMargin(salesTotal: 0, materialCost: 500).marginPct, isNull);
    });

    test('goes negative honestly when a big delivery lands', () {
      final m = grossMargin(salesTotal: 1000, materialCost: 4000);
      expect(m.margin, -3000);
      expect(m.marginPct, -300);
    });
  });

  group('the week', () {
    test('runs oldest to newest and ends on today', () {
      final week = buildWeek([], '2026-08-08');
      expect(week.length, 7);
      expect(week.first.date, '2026-08-02');
      expect(week.last.date, '2026-08-08');
      expect(week.last.isToday, isTrue);
    });

    test('adds up every outlet that closed on the same day', () {
      final week = buildWeek([
        {'businessDate': '2026-08-07', 'salesTotal': 4000},
        {'businessDate': '2026-08-07', 'salesTotal': 2500},
      ], '2026-08-08');
      expect(week[5].total, 6500);
    });

    test('takes today live, ignoring any closing already written for it', () {
      final week = buildWeek(
        [{'businessDate': '2026-08-08', 'salesTotal': 999}],
        '2026-08-08',
        todayLive: 1234,
      );
      expect(week.last.total, 1234);
    });
  });

  group('waste', () {
    test('is read from the reports, not recomputed', () {
      final summary = summariseWaste([
        {
          'wasteQty': 10,
          'wasteValue': 900,
          'transferVarianceValue': 100,
          'byProduct': [
            {
              'productId': 'p1',
              'productName': 'Bread Small',
              'received': 80,
              'carriedIn': 20,
              'sold': 90,
              'wasted': 10,
              'wastedValue': 900,
            },
          ],
        },
      ]);
      expect(summary.days, 1);
      expect(summary.wasteValue, 900);
      expect(summary.varianceValue, 100);
      expect(summary.wastePct, 10); // 10 of 100 available
      expect(summary.sellThroughPct, 90);
      expect(summary.worst.single.productName, 'Bread Small');
    });

    test('ranks the costliest first, not the most numerous', () {
      final summary = summariseWaste([
        {
          'byProduct': [
            {'productId': 'cake', 'productName': 'VIP Cake', 'wasted': 1, 'wastedValue': 1800},
            {'productId': 'bun', 'productName': 'Burger Bun', 'wasted': 20, 'wastedValue': 300},
          ],
        },
      ]);
      expect(summary.worst.first.productName, 'VIP Cake');
    });

    test('says nothing rather than 0% when no day has been closed', () {
      expect(summariseWaste([]).sellThroughPct, isNull);
    });
  });

  group('the day summary', () {
    test('counts a voided sale as a record but not as money', () {
      final summary = summariseDay([
        {'total': 500, 'payment': 'cash', 'status': 'normal'},
        {'total': 300, 'payment': 'card', 'status': 'voided'},
      ]);
      expect(summary.salesTotal, 500);
      expect(summary.cashTotal, 500);
      expect(summary.cardTotal, 0);
      expect(summary.txCount, 1);
      expect(summary.voidedCount, 1);
    });

    test('lets a refund pull the total down, because it keeps its sign', () {
      final summary = summariseDay([
        {'total': 1000, 'payment': 'cash', 'status': 'normal'},
        {'total': -250, 'payment': 'cash', 'status': 'refund'},
      ]);
      expect(summary.salesTotal, 750);
    });

    test('adds up best sellers by what they earned', () {
      final summary = summariseDay([
        {
          'total': 440,
          'status': 'normal',
          'lines': [
            {'productId': 'b2', 'name': 'Bread Large', 'qty': 2, 'price': 220},
          ],
        },
        {
          'total': 220,
          'status': 'normal',
          'lines': [
            {'productId': 'b2', 'name': 'Bread Large', 'qty': 1, 'price': 220},
          ],
        },
      ]);
      expect(summary.byProduct.single.qty, 3);
      expect(summary.byProduct.single.revenue, 660);
    });
  });

  group('what needs a look', () {
    final branches = [
      {'id': 'MAIN', 'name': 'Main Outlet'},
      {'id': 'B2', 'name': 'Gulberg'},
      {'id': 'B3', 'name': 'Model Town'},
    ];

    test('three outlets that never counted yesterday is one line, not three', () {
      final problems = findProblems(today: '2026-08-08', branches: branches);
      final uncounted =
          problems.where((p) => p.what.contains('never counted')).toList();
      expect(uncounted.length, 1);
      expect(uncounted.single.count, 3);
      expect(uncounted.single.where, contains('Gulberg'));
    });

    test('an outlet that did close is left out of that line', () {
      final problems = findProblems(
        today: '2026-08-08',
        branches: branches,
        closings: [
          {'businessDate': '2026-08-07', 'branchId': 'B2', 'status': 'closed'},
        ],
      );
      final uncounted =
          problems.firstWhere((p) => p.what.contains('never counted'));
      expect(uncounted.count, 2);
      expect(uncounted.where, isNot(contains('Gulberg')));
    });

    test('a day reopened today is raised', () {
      final problems = findProblems(
        today: '2026-08-08',
        closings: [
          {
            'businessDate': '2026-08-08',
            'branchId': 'B2',
            'status': 'reopened',
            'reopenedByName': 'Bilal',
            'reopenReason': 'miscount',
          },
        ],
      );
      expect(problems.first.what, contains('reopened'));
      expect(problems.first.where, contains('Bilal'));
      expect(problems.first.where, contains('miscount'));
    });

    test('stock short of a delivery is named with its reason', () {
      final problems = findProblems(
        today: '2026-08-08',
        transfers: [
          {
            'toBranchId': 'B2',
            'ref': 'T-0808-B2',
            'status': 'received',
            'items': [
              {
                'productName': 'Bread Small',
                'qtySent': 20,
                'qtyReceived': 14,
                'shortReason': 'damaged',
              },
            ],
          },
        ],
      );
      final short = problems.firstWhere((p) => p.what.contains('did not arrive'));
      expect(short.what, contains('6 × Bread Small'));
      expect(short.where, contains('damaged'));
    });

    test('a delivery counted in full raises nothing', () {
      final problems = findProblems(
        today: '2026-08-08',
        transfers: [
          {
            'toBranchId': 'B2',
            'ref': 'T-0808-B2',
            'status': 'received',
            'items': [
              {'productName': 'Bread Small', 'qtySent': 20, 'qtyReceived': 20},
            ],
          },
        ],
      );
      expect(problems.where((p) => p.what.contains('did not arrive')), isEmpty);
    });

    test('is capped, because a list of six warnings teaches him to ignore six', () {
      final many = [
        for (var i = 0; i < 20; i++)
          MaterialItem(id: 'm$i', name: 'Material $i', unit: 'kg', reorderLevel: 5),
      ];
      expect(findProblems(today: '2026-08-08', materials: many).length, 6);
    });
  });
}
