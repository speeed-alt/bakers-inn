/// Every amount is an integer in the currency's smallest unit — whole rupees
/// here. Never store a fractional currency value; all arithmetic stays exact.
///
/// The grouping is written out by hand rather than taken from `intl`. Two
/// reasons. It has to match `src/lib/money.js` character for character, because
/// the same figure is read off a tablet and off a printed sheet and the two must
/// not disagree; and `NumberFormat` needs locale data loaded before it will
/// behave, which is a runtime failure waiting to happen on a screen showing
/// takings. `Intl.NumberFormat('en-PK')` was checked in the browser: it groups
/// in threes, Western style, not in the Indian lakh/crore style.
library;

import '../config.dart';

String _group(int whole) {
  final digits = whole.toString();
  final buffer = StringBuffer();
  for (var i = 0; i < digits.length; i++) {
    // A separator goes before every third digit counting from the right, except
    // at the very start of the number.
    final fromRight = digits.length - i;
    if (i > 0 && fromRight % 3 == 0) buffer.write(',');
    buffer.write(digits[i]);
  }
  return buffer.toString();
}

String formatMoney(num? minor, {bool symbol = true}) {
  final n = (minor ?? 0).round();
  final sign = n < 0 ? '-' : '';
  final abs = n.abs();

  var text = _group(abs ~/ minorUnits);
  if (currencyDecimals > 0) {
    text += '.${(abs % minorUnits).toString().padLeft(currencyDecimals, '0')}';
  }

  return symbol ? '$sign$currencySymbol $text' : '$sign$text';
}

/// Parse a typed amount into minor units. Returns null if unusable.
int? parseMoney(Object? text) {
  if (text == null) return null;
  final cleaned = text.toString().replaceAll(RegExp(r'[^0-9.-]'), '');
  if (cleaned.isEmpty || cleaned == '-' || cleaned == '.') return null;
  final value = double.tryParse(cleaned);
  if (value == null || !value.isFinite) return null;
  return (value * minorUnits).round();
}

int toMinor(num major) => (major * minorUnits).round();

int lineTotal({required int price, required int qty}) => price * qty;

int basketTotal(Iterable<({int price, int qty})> lines) =>
    lines.fold(0, (sum, l) => sum + lineTotal(price: l.price, qty: l.qty));
