/// Human-readable ids with no global counter — global counters and offline
/// devices do not mix. Ids are either natural keys (one per outlet per day) or
/// come from a counter with exactly one writer.
///
/// Ported from `src/lib/ids.js`. These strings are the join between the two
/// clients: a sale rung on a Flutter tablet and one rung in the browser must
/// land on the same document id, or a day's takings get counted twice.
///
/// The device letter and the per-day sequence live in `DeviceStore`, which owns
/// the asynchronous storage; everything here is pure so it can be tested without
/// a device.
library;

import 'dates.dart';

String _seq3(int seq) => seq.toString().padLeft(3, '0');

String saleRef(String branchId, String businessDate, int seq, String letter) =>
    'S-$branchId-${shortDate(businessDate)}-$letter${_seq3(seq)}';

/// Deterministic document id: the same sale written twice (a retry after a
/// flaky connection) lands on the same document instead of duplicating takings.
///
/// DO NOT WRITE A SALE WITH THIS. It is the pre-2026-08-13 shape, kept only so
/// the parity test can read ids the web app wrote before that date. The web app
/// now appends a per-install token (`installId` in src/lib/ids.js) because the
/// letter and the sequence together are not unique: two tills both on 'A', or
/// one whose storage was cleared, mint an id that already exists, and the
/// refused write silently loses the *new* sale. This app has no till, so it has
/// never had the bug. Give it one before giving it a till.
String saleDocId(String branchId, String businessDate, int seq, String letter) =>
    'S-${compactDate(businessDate)}-$branchId-$letter${_seq3(seq)}';

String closingDocId(String businessDate, String branchId) =>
    'C-${compactDate(businessDate)}-$branchId';

String closingRef(String businessDate, String branchId) =>
    'C-${shortDate(businessDate)}-$branchId';

// --- the daily cycle -------------------------------------------------------
//
// Natural keys, not counters: there is exactly one order per outlet per day and
// one baking list per day, so the id can be worked out from the date and the
// outlet alone. No coordination, no counter to clash over, and re-running the
// compile lands on the same documents instead of duplicating them.

String demandDocId(String businessDate, String branchId) =>
    'D-${compactDate(businessDate)}-$branchId';

String demandRef(String businessDate, String branchId) =>
    'D-${shortDate(businessDate)}-$branchId';

String productionDocId(String businessDate) => 'PO-${compactDate(businessDate)}';

String productionRef(String businessDate) => 'PO-${shortDate(businessDate)}';

/// Transfers are the one record that can legitimately repeat in a day — a second
/// top-up run, or goods going back to the hub — so they carry a suffix.
/// [seq] 1 is the day's main delivery; 'R' marks a return to the hub.
String transferDocId(String businessDate, String branchId, [Object seq = 1]) {
  final suffix = seq == 1 ? '' : '-$seq';
  return 'T-${compactDate(businessDate)}-$branchId$suffix';
}

String transferRef(String businessDate, String branchId, [Object seq = 1]) {
  final suffix = seq == 1 ? '' : '-$seq';
  return 'T-${shortDate(businessDate)}-$branchId$suffix';
}

String reportDocId(String businessDate, String branchId) =>
    'R-${compactDate(businessDate)}-$branchId';

String reportRef(String businessDate, String branchId) =>
    'R-${shortDate(businessDate)}-$branchId';
