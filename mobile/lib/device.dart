/// What this particular tablet knows about itself: which outlet it stands in,
/// and which till it is.
///
/// Set once at setup and then never asked again — the owner's first rule. A
/// second till at the same outlet becomes 'B', and the two can mint sale ids
/// that never collide with no coordination between them.
library;

import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

class DeviceStore {
  DeviceStore(this._prefs);

  static const _branchKey = 'bakery.branchId';
  static const _letterKey = 'bakery.deviceLetter';
  static const _seqKey = 'bakery.saleSeq';

  final SharedPreferences _prefs;

  static Future<DeviceStore> load() async =>
      DeviceStore(await SharedPreferences.getInstance());

  String? get branchId => _prefs.getString(_branchKey);

  Future<void> setBranchId(String id) => _prefs.setString(_branchKey, id);

  Future<void> clearBranchId() => _prefs.remove(_branchKey);

  String get letter => _prefs.getString(_letterKey) ?? 'A';

  Future<void> setLetter(String letter) =>
      _prefs.setString(_letterKey, letter.toUpperCase().substring(0, 1));

  /// Per-device, per-day counter. Survives restarts and resets itself each day.
  ///
  /// One writer — this tablet — so it needs no coordination and works with no
  /// connection, which a server-side counter could not.
  Future<int> nextSaleSeq(String businessDate) async {
    Map<String, dynamic>? state;
    try {
      final raw = _prefs.getString(_seqKey);
      if (raw != null) state = jsonDecode(raw) as Map<String, dynamic>;
    } catch (_) {
      state = null;
    }
    if (state == null || state['date'] != businessDate) {
      state = {'date': businessDate, 'n': 0};
    }
    state['n'] = (state['n'] as int) + 1;
    await _prefs.setString(_seqKey, jsonEncode(state));
    return state['n'] as int;
  }
}
