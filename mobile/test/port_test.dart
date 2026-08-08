import 'package:flutter_test/flutter_test.dart';

import 'package:bakers_inn/core/dates.dart';
import 'package:bakers_inn/core/ids.dart';
import 'package:bakers_inn/core/money.dart';
import 'package:bakers_inn/core/pin.dart';

/// These are not tests of the Dart code so much as tests that the Dart code and
/// the JavaScript code are the same code.
///
/// Every expected value here was taken from the running web app, not worked out
/// by hand. Two clients now write to one database: the moment they disagree
/// about a document id, a business date or a derived password, the damage is
/// silent — duplicated takings, a sale filed under the wrong day, or a cashier
/// who cannot sign in on one device and can on another.
void main() {
  group('money formats exactly as the web app does', () {
    test('groups in threes, Western style, not lakh/crore', () {
      // Checked against Intl.NumberFormat('en-PK') in the browser.
      expect(formatMoney(1234, symbol: false), '1,234');
      expect(formatMoney(12345, symbol: false), '12,345');
      expect(formatMoney(123456, symbol: false), '123,456');
      expect(formatMoney(1234567, symbol: false), '1,234,567');
      expect(formatMoney(12345678, symbol: false), '12,345,678');
    });

    test('carries the rupee symbol and a space', () {
      expect(formatMoney(1400), 'Rs 1,400');
      expect(formatMoney(0), 'Rs 0');
    });

    test('a negative amount keeps its sign in front of the symbol', () {
      expect(formatMoney(-250), '-Rs 250');
    });

    test('null is nothing, not a crash — screens read straight from documents', () {
      expect(formatMoney(null), 'Rs 0');
    });

    test('parsing ignores whatever the keypad let through', () {
      expect(parseMoney('Rs 1,400'), 1400);
      expect(parseMoney('250'), 250);
      expect(parseMoney(''), isNull);
      expect(parseMoney('-'), isNull);
      expect(parseMoney(null), isNull);
    });

    test('a basket adds up its lines', () {
      expect(
        basketTotal([(price: 120, qty: 2), (price: 350, qty: 1)]),
        590,
      );
    });
  });

  group('business dates', () {
    test('a sale before 04:00 belongs to the day the shift started', () {
      expect(businessDateOf(DateTime(2026, 8, 8, 1, 30)), '2026-08-07');
      expect(businessDateOf(DateTime(2026, 8, 8, 3, 59)), '2026-08-07');
      expect(businessDateOf(DateTime(2026, 8, 8, 4, 0)), '2026-08-08');
      expect(businessDateOf(DateTime(2026, 8, 8, 19, 50)), '2026-08-08');
    });

    test('day arithmetic crosses month and year ends', () {
      expect(nextDate('2026-08-31'), '2026-09-01');
      expect(previousDate('2026-01-01'), '2025-12-31');
      expect(addDays('2026-02-27', 2), '2026-03-01');
    });

    test('the compact and short forms used inside ids', () {
      expect(compactDate('2026-07-29'), '20260729');
      expect(shortDate('2026-07-29'), '0729');
    });

    test('weekday and display formats', () {
      expect(weekdayName('2026-08-08'), 'Saturday');
      expect(formatDate('2026-08-08'), 'Sat, 8 Aug');
    });

    test('times read the way the sales list shows them', () {
      expect(formatTime(DateTime(2026, 8, 8, 11, 40)), '11:40 AM');
      expect(formatTime(DateTime(2026, 8, 8, 0, 5)), '12:05 AM');
      expect(formatTime(DateTime(2026, 8, 8, 12, 0)), '12:00 PM');
      expect(formatTime(DateTime(2026, 8, 8, 16, 5)), '4:05 PM');
      expect(formatTime(null), '');
    });
  });

  group('document ids match the ones already in the database', () {
    test('a sale, in both its shown and stored forms', () {
      // 'S-B2-0808-A001' is a real reference read off the deployed till.
      expect(saleRef('B2', '2026-08-08', 1, 'A'), 'S-B2-0808-A001');
      expect(saleDocId('B2', '2026-08-08', 1, 'A'), 'S-20260808-B2-A001');
      expect(saleRef('B2', '2026-08-08', 17, 'A'), 'S-B2-0808-A017');
    });

    test('the natural keys, one per outlet per day', () {
      expect(closingDocId('2026-08-08', 'B2'), 'C-20260808-B2');
      expect(demandDocId('2026-08-08', 'B2'), 'D-20260808-B2');
      expect(productionDocId('2026-08-08'), 'PO-20260808');
      expect(reportDocId('2026-08-08', 'B2'), 'R-20260808-B2');
    });

    test('a transfer suffixes only when it is not the first of the day', () {
      expect(transferDocId('2026-08-08', 'B2'), 'T-20260808-B2');
      expect(transferDocId('2026-08-08', 'B2', 2), 'T-20260808-B2-2');
      expect(transferDocId('2026-08-08', 'B2', 'R'), 'T-20260808-B2-R');
    });
  });

  group('PIN passwords match the browser exactly', () {
    // Taken from the web app's own pinPassword() running in the browser. If
    // these fail, nobody can sign in on Flutter with a PIN that works on the
    // tablet — and the error Firebase returns is just "wrong password".
    test('derives the same password the web app derives', () {
      expect(pinPassword('owner', '1111'), 'c11159b0286f992bb6028e4b3edfa99b');
      expect(pinPassword('bilal', '3333'), 'e1abeb919727a8f16d165fe5ff5b926d');
      expect(pinPassword('usman', '8427'), '0ade47473e31bf2ada111038a2401372');
    });

    test('the salt is per person, so a shared PIN is not a shared password', () {
      expect(pinPassword('owner', '1111'), isNot(pinPassword('ayesha', '1111')));
    });

    test('always 32 characters of lowercase hex', () {
      final password = pinPassword('hina', '4444');
      expect(password, hasLength(32));
      expect(RegExp(r'^[0-9a-f]{32}$').hasMatch(password), isTrue);
    });

    test('the email a login id maps to', () {
      expect(staffEmail('bilal'), 'bilal@staff.bakery.local');
    });

    test('a PIN is exactly four digits', () {
      expect(isValidPin('0000'), isTrue);
      expect(isValidPin('123'), isFalse);
      expect(isValidPin('12345'), isFalse);
      expect(isValidPin('12a4'), isFalse);
    });
  });
}
