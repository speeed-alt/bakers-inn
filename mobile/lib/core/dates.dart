/// A business date is a plain local 'YYYY-MM-DD' string, stamped by the device
/// at the moment a record is created. That is what makes an offline sale rung at
/// 19:50 and synced at 08:00 the next morning land on the correct day.
///
/// Ported from `src/lib/dates.js`. Both clients must agree on which day a sale
/// belongs to, or one outlet's takings land on a day the other has already
/// closed.
library;

import '../config.dart';

String toIsoDate(DateTime d) {
  final m = d.month.toString().padLeft(2, '0');
  final day = d.day.toString().padLeft(2, '0');
  return '${d.year}-$m-$day';
}

/// Which business day a moment belongs to. Before [dayRolloverHour] the takings
/// still belong to the day the shift started on.
String businessDateOf([DateTime? when]) {
  var d = when ?? DateTime.now();
  if (d.hour < dayRolloverHour) d = d.subtract(const Duration(days: 1));
  return toIsoDate(d);
}

/// Parse 'YYYY-MM-DD' at midday.
///
/// Midday, not midnight, on purpose: adding days to a local midnight lands on
/// the wrong date whenever a daylight-saving shift moves the clock backwards
/// over it. Pakistan does not currently observe one, but this arithmetic decides
/// which day a shop's takings belong to and should not depend on that staying
/// true.
DateTime _atMidday(String iso) {
  final parts = iso.split('-').map(int.parse).toList();
  return DateTime(parts[0], parts[1], parts[2], 12);
}

String addDays(String iso, int days) =>
    toIsoDate(_atMidday(iso).add(Duration(days: days)));

String nextDate(String iso) => addDays(iso, 1);

String previousDate(String iso) => addDays(iso, -1);

/// '2026-07-29' -> '20260729' — used inside document ids so they sort by date.
String compactDate(String iso) => iso.replaceAll('-', '');

/// '2026-07-29' -> '0729' — the short form staff see on printed refs.
String shortDate(String iso) => compactDate(iso).substring(4);

const List<String> _weekdays = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
];

const List<String> _shortWeekdays = [
  'Mon',
  'Tue',
  'Wed',
  'Thu',
  'Fri',
  'Sat',
  'Sun',
];

const List<String> _shortMonths = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/// DateTime.weekday is 1..7 starting at Monday.
String weekdayName(String iso) => _weekdays[_atMidday(iso).weekday - 1];

/// 'Sat, 8 Aug' — the same shape the web app shows.
String formatDate(String iso) {
  final d = _atMidday(iso);
  return '${_shortWeekdays[d.weekday - 1]}, ${d.day} ${_shortMonths[d.month - 1]}';
}

/// '4:05 PM'. Written out rather than taken from `intl` for the same reason as
/// the money grouping: no locale data to load, and no chance of the tablet and
/// the printed sheet disagreeing.
String formatTime(DateTime? date) {
  if (date == null) return '';
  final suffix = date.hour < 12 ? 'AM' : 'PM';
  var hour = date.hour % 12;
  if (hour == 0) hour = 12;
  return '$hour:${date.minute.toString().padLeft(2, '0')} $suffix';
}
