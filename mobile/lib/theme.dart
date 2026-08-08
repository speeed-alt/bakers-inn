/// One neutral palette, in two brightnesses.
///
/// The colours are the same hex values as `src/styles.css`, on purpose: a
/// cashier moving between a tablet running the app and a browser showing the
/// same figures should not feel they are looking at two products.
///
/// The owner's standing instruction is "minimalistically professional, nothing
/// flashy". So: no accent colour, no elevation, no tinted surfaces. Hierarchy
/// comes from weight, size and space. Red appears in exactly one place — money
/// that does not add up.
library;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:shared_preferences/shared_preferences.dart';

class BakeryColors extends ThemeExtension<BakeryColors> {
  const BakeryColors({
    required this.surface2,
    required this.border,
    required this.borderStrong,
    required this.muted,
    required this.ink,
    required this.inkText,
    required this.alert,
  });

  /// A quieter fill than a card: pressed rows, bar tracks, the row Enter rings up.
  final Color surface2;
  final Color border;

  /// Borders that have to be seen rather than merely felt — inputs, buttons.
  final Color borderStrong;

  /// Secondary text. Carries outlet names, dates and units, so it clears 6:1
  /// against the background rather than the 4.5:1 minimum.
  final Color muted;

  /// The primary action fill: near-black on light, near-white on dark.
  final Color ink;
  final Color inkText;

  /// Only for money that does not add up.
  final Color alert;

  static const light = BakeryColors(
    surface2: Color(0xFFF2F2F1),
    border: Color(0xFFE4E4E2),
    borderStrong: Color(0xFFCFCFCC),
    muted: Color(0xFF5E5E59),
    ink: Color(0xFF17171A),
    inkText: Color(0xFFFFFFFF),
    alert: Color(0xFFA32020),
  );

  static const dark = BakeryColors(
    surface2: Color(0xFF242427),
    border: Color(0xFF303034),
    borderStrong: Color(0xFF45454A),
    muted: Color(0xFFA6A6A2),
    ink: Color(0xFFECECEE),
    inkText: Color(0xFF17171A),
    alert: Color(0xFFE08B8B),
  );

  @override
  BakeryColors copyWith({
    Color? surface2,
    Color? border,
    Color? borderStrong,
    Color? muted,
    Color? ink,
    Color? inkText,
    Color? alert,
  }) =>
      BakeryColors(
        surface2: surface2 ?? this.surface2,
        border: border ?? this.border,
        borderStrong: borderStrong ?? this.borderStrong,
        muted: muted ?? this.muted,
        ink: ink ?? this.ink,
        inkText: inkText ?? this.inkText,
        alert: alert ?? this.alert,
      );

  @override
  BakeryColors lerp(ThemeExtension<BakeryColors>? other, double t) {
    if (other is! BakeryColors) return this;
    return BakeryColors(
      surface2: Color.lerp(surface2, other.surface2, t)!,
      border: Color.lerp(border, other.border, t)!,
      borderStrong: Color.lerp(borderStrong, other.borderStrong, t)!,
      muted: Color.lerp(muted, other.muted, t)!,
      ink: Color.lerp(ink, other.ink, t)!,
      inkText: Color.lerp(inkText, other.inkText, t)!,
      alert: Color.lerp(alert, other.alert, t)!,
    );
  }
}

/// Convenience so screens read `context.colors.muted` rather than digging the
/// extension out of the theme every time.
extension BakeryThemeAccess on BuildContext {
  BakeryColors get colors => Theme.of(this).extension<BakeryColors>()!;
  TextTheme get type => Theme.of(this).textTheme;
}

const double kRadius = 6;

/// Nothing tappable is smaller than this. Plain is not the same as small, and
/// these are used at speed by someone also serving a customer.
const double kTap = 48;

ThemeData _base(Brightness brightness) {
  final isDark = brightness == Brightness.dark;
  final colors = isDark ? BakeryColors.dark : BakeryColors.light;
  final background = isDark ? const Color(0xFF131314) : const Color(0xFFF7F7F6);
  final surface = isDark ? const Color(0xFF1C1C1E) : const Color(0xFFFFFFFF);
  final text = isDark ? const Color(0xFFECECEE) : const Color(0xFF17171A);

  final scheme = ColorScheme(
    brightness: brightness,
    primary: colors.ink,
    onPrimary: colors.inkText,
    secondary: colors.ink,
    onSecondary: colors.inkText,
    error: colors.alert,
    onError: isDark ? const Color(0xFF17171A) : Colors.white,
    surface: surface,
    onSurface: text,
  );

  return ThemeData(
    useMaterial3: true,
    brightness: brightness,
    colorScheme: scheme,
    scaffoldBackgroundColor: background,
    extensions: [colors],
    // 16px base, matching the web app: 15 was a desk assumption and this is read
    // at arm's length across a counter.
    textTheme: const TextTheme(
      bodyLarge: TextStyle(fontSize: 16, height: 1.5),
      bodyMedium: TextStyle(fontSize: 16, height: 1.5),
      bodySmall: TextStyle(fontSize: 13, height: 1.45),
      titleLarge: TextStyle(fontSize: 20, fontWeight: FontWeight.w600),
      titleMedium: TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
      labelLarge: TextStyle(fontSize: 15, fontWeight: FontWeight.w500),
    ).apply(bodyColor: text, displayColor: text),
    appBarTheme: AppBarTheme(
      backgroundColor: surface,
      foregroundColor: text,
      elevation: 0,
      scrolledUnderElevation: 0,
      surfaceTintColor: Colors.transparent,
      shape: Border(bottom: BorderSide(color: colors.border)),
      systemOverlayStyle:
          isDark ? SystemUiOverlayStyle.light : SystemUiOverlayStyle.dark,
    ),
    cardTheme: CardThemeData(
      color: surface,
      elevation: 0,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(kRadius),
        side: BorderSide(color: colors.border),
      ),
    ),
    dividerTheme: DividerThemeData(color: colors.border, space: 1, thickness: 1),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: colors.ink,
        foregroundColor: colors.inkText,
        minimumSize: const Size(0, kTap),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(kRadius)),
        textStyle: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        foregroundColor: text,
        backgroundColor: surface,
        minimumSize: const Size(0, kTap),
        side: BorderSide(color: colors.borderStrong),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(kRadius)),
        textStyle: const TextStyle(fontSize: 16, fontWeight: FontWeight.w500),
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(foregroundColor: colors.muted),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: surface,
      contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 14),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(kRadius),
        borderSide: BorderSide(color: colors.borderStrong),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(kRadius),
        borderSide: BorderSide(color: colors.borderStrong),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(kRadius),
        borderSide: BorderSide(color: colors.ink, width: 2),
      ),
      labelStyle: TextStyle(color: colors.muted, fontSize: 13),
    ),
  );
}

final ThemeData bakeryLight = _base(Brightness.light);
final ThemeData bakeryDark = _base(Brightness.dark);

/// Light or dark, one tap.
///
/// The icon shows the side you are going to, not the side you are on, because
/// "press the moon to get dark" needs no explaining to anybody. The tooltip says
/// it in words for screen readers and for a long press.
class ThemeToggleButton extends StatelessWidget {
  const ThemeToggleButton({super.key, required this.theme});

  final ThemeController theme;

  @override
  Widget build(BuildContext context) {
    final current = Theme.of(context).brightness;
    final goingDark = current != Brightness.dark;
    return IconButton(
      onPressed: () => theme.toggle(current),
      tooltip: goingDark ? 'Switch to dark' : 'Switch to light',
      icon: Icon(goingDark ? Icons.dark_mode_outlined : Icons.light_mode_outlined),
      color: context.colors.muted,
    );
  }
}

/// Light or dark, chosen once and remembered on this tablet.
///
/// With nothing stored the app follows the device, which is what a tablet that
/// dims itself in the evening already expects. The moment somebody taps the
/// toggle it becomes an explicit choice and stops following: a counter under a
/// bright window may want light all day even when Android has gone dark.
///
/// Same key and same rule as the web app's `src/lib/theme.js`, so a tablet
/// behaves the same whichever client it is running.
class ThemeController extends ChangeNotifier {
  ThemeController(this._mode);

  static const _key = 'bakery.theme';

  ThemeMode _mode;
  ThemeMode get mode => _mode;

  static Future<ThemeController> load() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final stored = prefs.getString(_key);
      return ThemeController(switch (stored) {
        'light' => ThemeMode.light,
        'dark' => ThemeMode.dark,
        _ => ThemeMode.system,
      });
    } catch (_) {
      // A locked-down device can refuse storage. Following the device is a fine
      // answer; refusing to start is not.
      return ThemeController(ThemeMode.system);
    }
  }

  /// Flip to the opposite of what is on screen right now. Resolving `system`
  /// against the actual platform brightness first is what makes the first tap
  /// do the obvious thing rather than appearing to do nothing.
  Future<void> toggle(Brightness current) async {
    _mode = current == Brightness.dark ? ThemeMode.light : ThemeMode.dark;
    notifyListeners();
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(_key, _mode == ThemeMode.dark ? 'dark' : 'light');
    } catch (_) {
      // Not being able to remember it is survivable; not applying it is not.
    }
  }
}
