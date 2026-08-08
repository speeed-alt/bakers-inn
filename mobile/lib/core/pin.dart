/// Staff sign in by tapping their name and entering a 4-digit PIN. Underneath,
/// each person is a real Firebase Auth account so every record carries a genuine
/// uid and the security rules have something to check.
///
/// Ported from `src/lib/pin.js`, and the port has to be exact. The derived
/// string *is* the account password: if this file and the browser's version
/// disagree by a single character, the same person with the same PIN gets a
/// different password and simply cannot sign in on one of the two clients.
/// `test/port_test.dart` pins it to values taken from the running web app.
library;

import 'dart:convert';

import 'package:crypto/crypto.dart';

const String staffEmailDomain = 'staff.bakery.local';

String staffEmail(String userId) => '$userId@$staffEmailDomain';

/// Derive the Firebase Auth password from a user id and PIN.
///
/// The PIN itself never travels and is never stored; a per-user salt means two
/// people sharing a PIN do not share a password. This is deliberate obscurity,
/// not real secrecy — the actual protection is the Firestore rules plus the
/// tablet being physically behind the counter.
String pinPassword(String userId, String pin) {
  final bytes = utf8.encode('bakery-pin-v1:$userId:$pin');
  // `Digest.toString()` is lowercase hex, which is what the browser's
  // byte-to-padded-hex loop produces.
  return sha256.convert(bytes).toString().substring(0, 32);
}

final _fourDigits = RegExp(r'^\d{4}$');

bool isValidPin(String pin) => _fourDigits.hasMatch(pin);
