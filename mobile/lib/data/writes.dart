/// Everything this app can change.
///
/// A direct counterpart to `src/data/catalog.js` and `src/data/materials.js`.
/// The field names and document shapes must match those exactly: the daily
/// report, the CSV export and the shop tablets all read what is written here,
/// and a record with a field spelled differently is a record they cannot see.
///
/// Nothing is ever deleted. Products and materials are archived, people are
/// turned off. The security rules permit no deletes at all, by anyone, so a
/// mistake here fails loudly rather than losing history.
library;

import 'package:cloud_firestore/cloud_firestore.dart';

import '../core/dates.dart';
import '../core/materials.dart';

final _db = FirebaseFirestore.instance;

/// Who did it. Every change is stamped, because visibility is what this system
/// has instead of approval queues.
typedef Actor = ({String id, String name});

// --- the catalog -----------------------------------------------------------

/// Save a product. A null id creates one.
Future<void> saveProduct(String? id, Map<String, dynamic> data) {
  if (id != null) return _db.collection('products').doc(id).update(data);
  return _db.collection('products').add({'active': true, ...data}).then((_) {});
}

/// Products are archived, never deleted, so old sales still make sense — a
/// receipt from March has to keep rendering with the name and price it was
/// actually rung at.
Future<void> archiveProduct(String id, {required bool archived}) =>
    _db.collection('products').doc(id).update({'active': !archived});

/// Turning somebody off removes them from every login list at once.
///
/// It does **not** revoke a session already signed in on a tablet. The role and
/// outlet the rules check live on the token, and only the `syncStaffClaims`
/// Cloud Function can rewrite those. Until the functions are deployed, treat
/// this as "cannot sign in again" rather than "locked out now", and sign the
/// tablet out by hand if it matters today.
Future<void> setUserActive(String id, {required bool active}) =>
    _db.collection('users').doc(id).update({'active': active});

// --- raw materials ---------------------------------------------------------

/// Save a material. A null id creates one, with its counters at zero so nobody
/// inherits a figure nobody counted.
Future<void> saveMaterial(String? id, Map<String, dynamic> data) {
  if (id != null) return _db.collection('rawMaterials').doc(id).update(data);
  return _db.collection('rawMaterials').add({
    'active': true,
    'onHand': 0,
    'receivedSinceCount': 0,
    'spoiledSinceCount': 0,
    ...data,
  }).then((_) {});
}

/// A single ledger entry, and the new shelf figure that follows from it.
///
/// A count is the interesting one: it is the moment the shelf gets to correct
/// the paperwork, and the gap between two counts is what tells us how fast the
/// material is really being used. Both writes go in one batch, so there is
/// never a movement without the stock it moved, or stock without its reason.
Future<void> recordMovement({
  required MaterialItem material,
  required Map<String, dynamic> raw,
  required String type,
  required double qty,
  String? note,
  required Actor user,
}) async {
  final now = DateTime.now();
  final businessDate = businessDateOf(now);
  final batch = _db.batch();

  batch.set(_db.collection('stockMovements').doc(), {
    'materialId': material.id,
    'materialName': material.name,
    'type': type,
    'qty': qty,
    'note': note,
    'businessDate': businessDate,
    'by': user.id,
    'byName': user.name,
    'at': Timestamp.fromDate(now),
  });

  final patch = <String, dynamic>{
    'onHand': applyMovement(material.onHand, type: type, qty: qty),
  };

  double since(String field) => ((raw[field] as num?) ?? 0).toDouble();

  if (type == kReceived) {
    patch['receivedSinceCount'] = since('receivedSinceCount') + qty;
  } else if (type == kSpoilage) {
    patch['spoiledSinceCount'] = since('spoiledSinceCount') + qty;
  } else if (type == kCount) {
    final previousAt = (raw['lastCountAt'] as Timestamp?)?.toDate();
    final elapsed = previousAt == null
        ? null
        : now.difference(previousAt).inMilliseconds / 86400000;
    final usage = usageBetweenCounts(
      previousCount: (raw['lastCountQty'] as num?)?.toDouble(),
      receivedSince: since('receivedSinceCount'),
      spoiledSince: since('spoiledSinceCount'),
      countedNow: qty,
      // Under half a day apart and the rate would be nonsense — two counts in
      // one afternoon say nothing about how fast a sack of flour goes down.
      days: (elapsed != null && elapsed >= 0.5) ? elapsed : null,
    );
    if (usage != null) {
      patch['usagePerDay'] = (usage.perDay * 100).round() / 100;
    }
    patch['lastCountAt'] = Timestamp.fromDate(now);
    patch['lastCountQty'] = qty;
    patch['receivedSinceCount'] = 0;
    patch['spoiledSinceCount'] = 0;
  }

  batch.update(_db.collection('rawMaterials').doc(material.id), patch);
  await batch.commit();
}

typedef PurchaseLine = ({
  String materialId,
  String materialName,
  String unit,
  double qty,
  double unitCost,
  double onHandBefore,
  double receivedSinceCountBefore,
});

/// A purchase, and the stock it puts on the shelf, written together.
///
/// The owner types the delivery once. The ledger entries and the new on-hand
/// figures follow from it in the same batch, so there is never a purchase
/// recorded without the stock, or stock without the purchase.
Future<void> recordPurchase({
  required List<PurchaseLine> items,
  String? supplier,
  required Actor user,
}) async {
  final now = DateTime.now();
  final businessDate = businessDateOf(now);
  final batch = _db.batch();
  final purchase = _db.collection('purchases').doc();

  batch.set(purchase, {
    'ref': 'P-${compactDate(businessDate)}-'
        '${purchase.id.substring(0, 4).toUpperCase()}',
    'businessDate': businessDate,
    'supplier': supplier,
    'items': [
      for (final i in items)
        {
          'materialId': i.materialId,
          'materialName': i.materialName,
          'unit': i.unit,
          'qty': i.qty,
          'unitCost': i.unitCost,
          'lineTotal': (i.qty * i.unitCost).round(),
        },
    ],
    'total': purchaseTotal(
      [for (final i in items) (qty: i.qty, unitCost: i.unitCost)],
    ),
    'createdBy': user.id,
    'createdByName': user.name,
    'createdAt': Timestamp.fromDate(now),
    'syncedAt': FieldValue.serverTimestamp(),
  });

  for (final item in items) {
    batch.set(_db.collection('stockMovements').doc(), {
      'materialId': item.materialId,
      'materialName': item.materialName,
      'type': kReceived,
      'qty': item.qty,
      'unitCost': item.unitCost,
      'businessDate': businessDate,
      'purchaseRef': purchase.id,
      'by': user.id,
      'byName': user.name,
      'at': Timestamp.fromDate(now),
    });
    batch.update(_db.collection('rawMaterials').doc(item.materialId), {
      'onHand':
          applyMovement(item.onHandBefore, type: kReceived, qty: item.qty),
      'receivedSinceCount': item.receivedSinceCountBefore + item.qty,
      // The last price paid becomes the price stock is valued at. It is the
      // only honest figure available without tracking every batch separately.
      'costPerUnit': item.unitCost,
      'lastPurchaseAt': Timestamp.fromDate(now),
    });
  }

  await batch.commit();
}
