/// Layout regressions worth catching before they reach a phone.
library;

import 'package:bakers_inn/theme.dart';
import 'package:bakers_inn/widgets/shell.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

Widget wrap(Widget child, {Size size = const Size(392, 850)}) {
  return MaterialApp(
    theme: bakeryDark,
    home: MediaQuery(
      data: MediaQueryData(size: size),
      child: Scaffold(
        body: SingleChildScrollView(
          child: Padding(padding: const EdgeInsets.all(20), child: child),
        ),
      ),
    ),
  );
}

const sixStats = <({String label, String value})>[
  (label: 'Takings', value: 'Rs 370'),
  (label: 'Sales', value: '1'),
  (label: 'Cash', value: 'Rs 370'),
  (label: 'Card', value: 'Rs 0'),
  (label: 'Week so far', value: 'Rs 2,390'),
  (label: 'Day average', value: 'Rs 1,195'),
];

void main() {
  group('the stat grid', () {
    testWidgets('puts two figures on a row rather than one', (tester) async {
      await tester.binding.setSurfaceSize(const Size(392, 850));
      addTearDown(() => tester.binding.setSurfaceSize(null));

      await tester.pumpWidget(wrap(const StatGrid(stats: sixStats)));

      // The bug this guards: the cells were sized from the outer constraints
      // while the Wrap sat inside a 1px border, so two cells plus their gap came
      // to two pixels more than the room available. Everything stacked into one
      // column and the other half of the card was a dead strip of border.
      final takings = tester.getTopLeft(find.text('TAKINGS'));
      final sales = tester.getTopLeft(find.text('SALES'));

      expect(sales.dy, takings.dy,
          reason: 'TAKINGS and SALES should share the first row');
      expect(sales.dx, greaterThan(takings.dx),
          reason: 'SALES should sit to the right of TAKINGS');
    });

    testWidgets('fills the width, leaving no dead strip', (tester) async {
      await tester.binding.setSurfaceSize(const Size(392, 850));
      addTearDown(() => tester.binding.setSurfaceSize(null));

      await tester.pumpWidget(wrap(const StatGrid(stats: sixStats)));

      final grid = tester.getSize(find.byType(StatGrid));
      final cash = tester.getTopLeft(find.text('CASH'));
      final card = tester.getTopLeft(find.text('CARD'));

      // The second column starts about halfway across. Anything much less and
      // the cells are not spanning the card.
      expect(card.dx - cash.dx, greaterThan(grid.width * 0.4));
    });

    testWidgets('six figures make three rows, not six', (tester) async {
      await tester.binding.setSurfaceSize(const Size(392, 850));
      addTearDown(() => tester.binding.setSurfaceSize(null));

      await tester.pumpWidget(wrap(const StatGrid(stats: sixStats)));

      final rows = <double>{
        for (final label in ['TAKINGS', 'SALES', 'CASH', 'CARD', 'WEEK SO FAR', 'DAY AVERAGE'])
          tester.getTopLeft(find.text(label)).dy,
      };
      expect(rows.length, 3);
    });

    testWidgets('a wide screen puts them all on one row', (tester) async {
      await tester.binding.setSurfaceSize(const Size(1100, 800));
      addTearDown(() => tester.binding.setSurfaceSize(null));

      await tester.pumpWidget(
        wrap(const StatGrid(stats: sixStats), size: const Size(1100, 800)),
      );

      final rows = <double>{
        for (final label in ['TAKINGS', 'SALES', 'CASH', 'CARD'])
          tester.getTopLeft(find.text(label)).dy,
      };
      expect(rows.length, 1);
    });
  });

  group('loading says what it is doing', () {
    testWidgets('a spinner never appears without words beside it',
        (tester) async {
      await tester.pumpWidget(wrap(const LoadingNote(text: 'Reading the storeroom…')));

      expect(find.byType(CircularProgressIndicator), findsOneWidget);
      expect(find.text('Reading the storeroom…'), findsOneWidget);
    });

    testWidgets('has a sensible default', (tester) async {
      await tester.pumpWidget(wrap(const LoadingNote()));
      expect(find.text('Loading…'), findsOneWidget);
    });
  });
}
