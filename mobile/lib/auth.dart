/// Tap a name, enter a 4-digit PIN.
///
/// Underneath, each person is a real Firebase Auth account, so every record
/// carries a genuine uid and the security rules have something to check.
///
/// The role and outlet are read twice, from two places, and compared. The rules
/// read them from the token's custom claims; the app shows them from the /users
/// document. When those disagree the app looks perfectly normal while every
/// write is silently refused — which is the single most confusing failure this
/// system can produce. [claimsStale] surfaces it instead of hiding it. The same
/// guard exists in the web app's `src/auth.jsx`; do not remove either.
library;

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/foundation.dart';

import 'core/pin.dart';

class StaffProfile {
  const StaffProfile({
    required this.uid,
    required this.name,
    required this.role,
    required this.branchId,
    required this.active,
  });

  final String uid;
  final String name;
  final String role;
  final String branchId;
  final bool active;

  bool get isOwner => role == 'owner';

  static StaffProfile? fromDoc(DocumentSnapshot<Map<String, dynamic>> doc) {
    final data = doc.data();
    if (data == null) return null;
    return StaffProfile(
      uid: doc.id,
      name: (data['name'] ?? '') as String,
      role: (data['role'] ?? '') as String,
      branchId: (data['branchId'] ?? '') as String,
      active: data['active'] == true,
    );
  }
}

/// Someone who can be signed in: shown on the login screen before anybody has
/// authenticated, which is why /users is world-readable. No secrets live there.
class StaffOption {
  const StaffOption({required this.uid, required this.name, required this.role});

  final String uid;
  final String name;
  final String role;
}

class AuthController extends ChangeNotifier {
  AuthController() {
    _auth.authStateChanges().listen(_onUser);
  }

  final FirebaseAuth _auth = FirebaseAuth.instance;
  final FirebaseFirestore _db = FirebaseFirestore.instance;

  User? _user;
  StaffProfile? _profile;
  bool _loading = true;
  bool _claimsStale = false;

  User? get user => _user;
  StaffProfile? get profile => _profile;
  bool get loading => _loading;

  /// The token says something different from the staff record. Every write will
  /// be refused until the token catches up.
  bool get claimsStale => _claimsStale;

  Future<void> _onUser(User? user) async {
    _user = user;
    if (user == null) {
      _profile = null;
      _claimsStale = false;
      _loading = false;
      notifyListeners();
      return;
    }

    final doc = await _db.collection('users').doc(user.uid).get();
    _profile = StaffProfile.fromDoc(doc);
    await _checkClaims();
    _loading = false;
    notifyListeners();
  }

  Future<void> _checkClaims() async {
    final profile = _profile;
    final user = _user;
    if (profile == null || user == null) return;

    var claims = (await user.getIdTokenResult()).claims ?? const {};
    var agrees = claims['role'] == profile.role &&
        claims['branchId'] == profile.branchId &&
        claims['active'] == profile.active;

    if (!agrees) {
      // One forced refresh: syncStaffClaims may simply not have caught up yet,
      // and a token minted before it ran carries the old values.
      claims = (await user.getIdTokenResult(true)).claims ?? const {};
      agrees = claims['role'] == profile.role &&
          claims['branchId'] == profile.branchId &&
          claims['active'] == profile.active;
    }
    _claimsStale = !agrees;
  }

  /// Everyone who could sign in at this outlet. The owner is listed everywhere,
  /// because he moves between shops; everyone else only where they work.
  Stream<List<StaffOption>> staffAt(String branchId) => _db
      .collection('users')
      .where('active', isEqualTo: true)
      .snapshots()
      .map((snap) => snap.docs
          .map((d) => (data: d.data(), id: d.id))
          .where((row) =>
              row.data['role'] == 'owner' || row.data['branchId'] == branchId)
          .map((row) => StaffOption(
                uid: row.id,
                name: (row.data['name'] ?? '') as String,
                role: (row.data['role'] ?? '') as String,
              ))
          .toList()
        ..sort((a, b) => a.name.compareTo(b.name)));

  /// Returns null on success, or a message plain enough to read at a counter.
  Future<String?> signIn(String uid, String pin) async {
    if (!isValidPin(pin)) return 'A PIN is four digits.';
    try {
      await _auth.signInWithEmailAndPassword(
        email: staffEmail(uid),
        password: pinPassword(uid, pin),
      );
      return null;
    } on FirebaseAuthException catch (error) {
      return switch (error.code) {
        'wrong-password' || 'invalid-credential' || 'user-not-found' =>
          'That PIN is not right.',
        'network-request-failed' =>
          'No connection, and this tablet has not signed in before.',
        'too-many-requests' => 'Too many tries. Wait a minute, then try again.',
        _ => 'Could not sign in (${error.code}).',
      };
    }
  }

  Future<void> signOut() => _auth.signOut();
}
