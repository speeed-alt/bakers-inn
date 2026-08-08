import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:bakers_inn/theme.dart';

/// The toggle is one button, so the behaviour worth pinning down is the part
/// nobody sees: what it does the *first* time, when the tablet is still
/// following the device, and whether the choice survives a restart.
void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  group('choosing a side', () {
    test('with nothing stored, the tablet follows the device', () async {
      final theme = await ThemeController.load();
      expect(theme.mode, ThemeMode.system);
    });

    test('the first tap flips away from what is actually on screen', () async {
      // The trap this guards: resolving `system` as "not dark" would make the
      // first tap on an already-dark tablet appear to do nothing at all.
      final theme = await ThemeController.load();
      expect(theme.mode, ThemeMode.system);

      await theme.toggle(Brightness.dark);
      expect(theme.mode, ThemeMode.light);
    });

    test('and the other way round', () async {
      final theme = await ThemeController.load();
      await theme.toggle(Brightness.light);
      expect(theme.mode, ThemeMode.dark);
    });

    test('an explicit choice outlives a restart', () async {
      final first = await ThemeController.load();
      await first.toggle(Brightness.light);
      expect(first.mode, ThemeMode.dark);

      // A fresh controller is what the next launch builds.
      final next = await ThemeController.load();
      expect(next.mode, ThemeMode.dark);
    });

    test('it stores under the same key the web app uses', () async {
      final theme = await ThemeController.load();
      await theme.toggle(Brightness.light);
      final prefs = await SharedPreferences.getInstance();
      // Same key as src/lib/theme.js, so a tablet behaves the same whichever
      // client it happens to be running.
      expect(prefs.getString('bakery.theme'), 'dark');
    });

    test('listeners are told, so the app repaints', () async {
      final theme = await ThemeController.load();
      var notified = 0;
      theme.addListener(() => notified++);
      await theme.toggle(Brightness.light);
      expect(notified, 1);
    });
  });

  group('the palette holds the line the owner asked for', () {
    test('both brightnesses carry the full set of colours', () {
      for (final theme in [bakeryLight, bakeryDark]) {
        expect(theme.extension<BakeryColors>(), isNotNull);
      }
    });

    test('the same hex values as the web app', () {
      expect(BakeryColors.light.muted, const Color(0xFF5E5E59));
      expect(BakeryColors.dark.muted, const Color(0xFFA6A6A2));
      expect(BakeryColors.light.ink, const Color(0xFF17171A));
      expect(BakeryColors.dark.ink, const Color(0xFFECECEE));
    });

    test('nothing is raised off the page — no shadows, no gradients', () {
      for (final theme in [bakeryLight, bakeryDark]) {
        expect(theme.cardTheme.elevation, 0);
        expect(theme.appBarTheme.elevation, 0);
        expect(theme.appBarTheme.scrolledUnderElevation, 0);
      }
    });

    test('body text is 16px, not the 15 that was a desk assumption', () {
      expect(bakeryLight.textTheme.bodyMedium?.fontSize, 16);
      expect(bakeryDark.textTheme.bodyMedium?.fontSize, 16);
    });
  });

  testWidgets('the toggle offers the side you are going to', (tester) async {
    final theme = await ThemeController.load();

    Widget app(ThemeMode mode) => MaterialApp(
          theme: bakeryLight,
          darkTheme: bakeryDark,
          themeMode: mode,
          home: Scaffold(
            appBar: AppBar(actions: [ThemeToggleButton(theme: theme)]),
          ),
        );

    await tester.pumpWidget(app(ThemeMode.light));
    expect(find.byTooltip('Switch to dark'), findsOneWidget);

    await tester.pumpWidget(app(ThemeMode.dark));
    await tester.pumpAndSettle();
    expect(find.byTooltip('Switch to light'), findsOneWidget);
  });
}
