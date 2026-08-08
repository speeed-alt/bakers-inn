/// The storeroom, as the owner needs it away from the shop: what is running
/// out, what is on the shelf, and what it is worth.
///
/// The web version puts this in a six-column table — material, on hand, used
/// per day, days left, and two buttons. That is fine on a counter tablet and
/// unreadable on a phone, so here each material is a row: its name and state on
/// the left, the quantity on the right, and the derived figures underneath in
/// plain words rather than as unlabelled columns.
///
/// Reads only, like the rest of the owner's app. Adjusting a count or logging a
/// purchase happens at the shop, on the tablet, next to the shelf being counted
/// — not from a phone in a car, where a typo has nothing to check it against.
library;

import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';

import '../config.dart';
import '../core/dates.dart';
import '../core/materials.dart';
import '../core/money.dart';
import '../data/writes.dart';
import '../theme.dart';
import '../widgets/sheet.dart';
import '../widgets/shell.dart';

class MaterialsScreen extends StatefulWidget {
  const MaterialsScreen({super.key, required this.user});

  /// Stamped onto every movement and purchase, so the owner can always see who
  /// counted what.
  final Actor user;

  @override
  State<MaterialsScreen> createState() => _MaterialsScreenState();
}

class _MaterialsScreenState extends State<MaterialsScreen> {
  final _db = FirebaseFirestore.instance;
  StreamSubscription? _materialsSub;
  StreamSubscription? _purchasesSub;

  List<MaterialItem> _materials = const [];
  /// The untouched documents, kept alongside the parsed ones because a movement
  /// needs the running counters (`receivedSinceCount`, `lastCountAt`) that the
  /// display model has no reason to carry.
  Map<String, Map<String, dynamic>> _rawById = const {};
  List<Map<String, dynamic>> _purchases = const [];
  Object? _error;
  bool _loading = true;

  @override
  void initState() {
    super.initState();

    _materialsSub = _db.collection('rawMaterials').snapshots().listen(
      (snap) {
        if (!mounted) return;
        setState(() {
          _materials = snap.docs
              .map((d) => MaterialItem.fromMap(d.id, d.data()))
              .where((m) => m.active)
              .toList()
            ..sort((a, b) => a.name.compareTo(b.name));
          _rawById = {for (final d in snap.docs) d.id: d.data()};
          _loading = false;
        });
      },
      onError: (Object e) {
        if (!mounted) return;
        setState(() {
          _error = e;
          _loading = false;
        });
      },
    );

    _purchasesSub = _db
        .collection('purchases')
        .orderBy('businessDate', descending: true)
        .limit(10)
        .snapshots()
        .listen(
      (snap) {
        if (!mounted) return;
        setState(() {
          _purchases = snap.docs.map((d) => {'id': d.id, ...d.data()}).toList();
        });
      },
      // Purchases only feed the panel at the bottom. Losing them should not
      // take the stock figures down with it.
      onError: (Object _) {},
    );
  }

  @override
  void dispose() {
    _materialsSub?.cancel();
    _purchasesSub?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (_error != null) {
      return ListView(
        padding: const EdgeInsets.all(20),
        children: [ProblemNote(message: '$_error')],
      );
    }
    if (_loading) {
      return const LoadingNote(text: 'Reading the storeroom…');
    }

    final colors = context.colors;
    final low = lowStock(_materials);
    final value = stockValue(_materials);
    final counted = _materials.where((m) => m.usagePerDay != null).length;

    return ListView(
      padding: const EdgeInsets.fromLTRB(20, 20, 20, 40),
      children: [
        Text('Raw materials', style: context.type.titleLarge),
        const SizedBox(height: 4),
        Text(
          'How fast something is used, and how many days are left, follow from '
          'what was bought and what was counted — there are no recipes to keep '
          'up to date.',
          style: TextStyle(fontSize: 13, color: colors.muted, height: 1.45),
        ),
        const SizedBox(height: 16),

        StatGrid(stats: [
          (label: 'Stock worth', value: formatMoney(value)),
          (label: 'Running low', value: '${low.length} of ${_materials.length}'),
        ]),

        const SizedBox(height: 12),
        Row(
          children: [
            Expanded(
              child: FilledButton.icon(
                onPressed: _materials.isEmpty ? null : _newPurchase,
                icon: const Icon(Icons.add_shopping_cart, size: 20),
                label: const Text('New purchase'),
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: OutlinedButton.icon(
                onPressed: () => _editMaterial(null),
                icon: const Icon(Icons.add, size: 20),
                label: const Text('Add material'),
              ),
            ),
          ],
        ),

        if (low.isNotEmpty) ...[
          const SizedBox(height: 26),
          SectionTitle('Running low', aside: '${low.length}'),
          Panel(children: [
            for (final m in low)
              PanelLine(
                left: m.name,
                detail: _why(m),
                right: '${_tidy(m.onHand)} ${m.unit}',
              ),
          ]),
        ],

        const SizedBox(height: 26),
        SectionTitle(
          'On the shelf',
          aside: counted == 0 ? null : '$counted measured',
        ),
        Panel(children: [
          if (_materials.isEmpty)
            const EmptyNote('No materials yet.')
          else
            for (final m in _materials)
              PanelLine(
                left: m.name,
                detail: _detail(m),
                right: '${_tidy(m.onHand)} ${m.unit}',
                note: isLow(m) ? 'low' : null,
                noteIsAlert: isLow(m),
                trailing:
                    Icon(Icons.chevron_right, size: 20, color: colors.muted),
                onTap: () => _adjust(m),
              ),
        ]),

        const SizedBox(height: 26),
        const SectionTitle('Recent purchases'),
        Panel(children: [
          if (_purchases.isEmpty)
            const EmptyNote('Nothing bought yet.')
          else
            for (final p in _purchases)
              PanelLine(
                left: formatDate((p['businessDate'] ?? '') as String),
                detail: [
                  if (p['supplier'] != null) '${p['supplier']}',
                  '${((p['items'] as List?) ?? const []).length} lines',
                ].join(' · '),
                right: formatMoney(((p['total'] as num?) ?? 0).round()),
              ),
        ]),

        const SizedBox(height: 16),
        Text(
          'Counting is what teaches the system how fast something is used, so '
          'the more often the shelf is counted the better the days-left figure '
          'gets. Nothing here is ever deleted — a wrong count is corrected by '
          'counting again.',
          style: TextStyle(fontSize: 13, color: colors.muted, height: 1.45),
        ),
      ],
    );
  }

  Future<void> _adjust(MaterialItem material) async {
    final done = await openSheet<String>(
      context,
      _MovementForm(
        material: material,
        raw: _rawById[material.id] ?? const {},
        user: widget.user,
        onEdit: () => _editMaterial(material),
      ),
    );
    if (done != null && mounted) {
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(done)));
    }
  }

  Future<void> _editMaterial(MaterialItem? material) async {
    final saved = await openSheet<bool>(
      context,
      _MaterialForm(existing: material),
    );
    if (saved == true && mounted) {
      ScaffoldMessenger.of(context)
          .showSnackBar(const SnackBar(content: Text('Saved.')));
    }
  }

  Future<void> _newPurchase() async {
    final done = await openSheet<String>(
      context,
      _PurchaseForm(
        materials: _materials,
        rawById: _rawById,
        user: widget.user,
      ),
    );
    if (done != null && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(done)));
    }
  }

  /// Why this material is in the low list — the reorder level, or the rate.
  String _why(MaterialItem m) {
    final days = daysOfStock(m);
    if (days == null) {
      return 'under the reorder level of ${_tidy(m.reorderLevel)} ${m.unit}';
    }
    final whole = days.floor();
    return 'about $whole day${whole == 1 ? '' : 's'} left at the current rate';
  }

  /// The two derived figures, said in words rather than shown as columns.
  String _detail(MaterialItem m) {
    final parts = <String>['${formatMoney(m.costPerUnit.round())} per ${m.unit}'];
    final perDay = m.usagePerDay;
    if (perDay != null && perDay > 0) {
      parts.add('${_tidy(perDay)} ${m.unit} a day');
      final days = daysOfStock(m);
      if (days != null) parts.add('${days.floor()} days left');
    } else {
      // Said out loud: an empty column reads as zero, and zero usage would be
      // a very different claim from "nobody has counted this twice yet".
      parts.add('not measured yet');
    }
    return parts.join(' · ');
  }
}

/// 8 rather than 8.0, but 8.5 kept.
String _tidy(double value) =>
    value == value.roundToDouble() ? '${value.round()}' : '$value';

/// One thing happening to one material.
///
/// Counting is first and selected by default, because it is both the commonest
/// and the only one that teaches the system anything: the gap between two
/// counts is where the usage rate comes from.
class _MovementForm extends StatefulWidget {
  const _MovementForm({
    required this.material,
    required this.raw,
    required this.user,
    required this.onEdit,
  });

  final MaterialItem material;
  final Map<String, dynamic> raw;
  final Actor user;
  final VoidCallback onEdit;

  @override
  State<_MovementForm> createState() => _MovementFormState();
}

class _MovementFormState extends State<_MovementForm> {
  final _qty = TextEditingController();
  final _note = TextEditingController();
  String _type = kCount;
  bool _busy = false;

  double? get _value => double.tryParse(_qty.text.trim());
  bool get _valid => _value != null && _value! >= 0;

  @override
  void dispose() {
    _qty.dispose();
    _note.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final m = widget.material;
    final after = _valid
        ? applyMovement(m.onHand, type: _type, qty: _value!)
        : m.onHand;

    return FormSheet(
      title: m.name,
      saveLabel: switch (_type) {
        kCount => 'Record the count',
        kSpoilage => 'Record what went bad',
        _ => 'Record what came in',
      },
      busy: _busy,
      onSave: _valid ? _save : null,
      note: switch (_type) {
        kCount =>
          'Type what is actually on the shelf, not the difference. This is the '
              'moment the shelf corrects the paperwork, and the gap since the '
              'last count is what sets the usage rate.',
        kSpoilage => 'Thrown away before it could be used.',
        _ => 'A delivery outside a purchase — a gift, or a swap.',
      },
      destructive: OutlinedButton(
        onPressed: _busy
            ? null
            : () {
                Navigator.of(context).pop();
                widget.onEdit();
              },
        child: const Text('Edit its details'),
      ),
      children: [
        SheetChoice<String>(
          label: 'What happened',
          value: _type,
          options: const [
            (value: kCount, label: 'Counted'),
            (value: kReceived, label: 'Came in'),
            (value: kSpoilage, label: 'Went bad'),
          ],
          onChanged: (t) => setState(() => _type = t),
        ),
        SheetField(
          label: _type == kCount ? 'On the shelf now' : 'How much',
          controller: _qty,
          number: true,
          autofocus: true,
          suffix: m.unit,
          onChanged: (_) => setState(() {}),
        ),
        SheetField(label: 'Note (optional)', controller: _note),
        Padding(
          padding: const EdgeInsets.only(bottom: 6),
          child: Text(
            'Now ${_tidy(m.onHand)} ${m.unit} → will be ${_tidy(after)} ${m.unit}',
            style: TextStyle(fontSize: 14, color: context.colors.muted),
          ),
        ),
      ],
    );
  }

  Future<void> _save() async {
    setState(() => _busy = true);
    try {
      await recordMovement(
        material: widget.material,
        raw: widget.raw,
        type: _type,
        qty: _value!,
        note: _note.text.trim().isEmpty ? null : _note.text.trim(),
        user: widget.user,
      );
      if (mounted) {
        Navigator.of(context).pop('${widget.material.name} updated.');
      }
    } catch (error) {
      if (!mounted) return;
      setState(() => _busy = false);
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text('Could not save: $error')));
    }
  }
}

/// The description of a material — never its quantity. Stock only ever moves
/// through a counted movement, so there is no field here that could quietly
/// rewrite the shelf.
class _MaterialForm extends StatefulWidget {
  const _MaterialForm({required this.existing});

  final MaterialItem? existing;

  @override
  State<_MaterialForm> createState() => _MaterialFormState();
}

class _MaterialFormState extends State<_MaterialForm> {
  late final _name = TextEditingController(text: widget.existing?.name ?? '');
  late final _unit = TextEditingController(text: widget.existing?.unit ?? '');
  late final _cost = TextEditingController(
      text: widget.existing == null
          ? ''
          : '${widget.existing!.costPerUnit.round()}');
  late final _reorder = TextEditingController(
      text: widget.existing == null ? '' : _tidy(widget.existing!.reorderLevel));
  bool _busy = false;

  bool get _isNew => widget.existing == null;
  bool get _valid =>
      _name.text.trim().isNotEmpty && _unit.text.trim().isNotEmpty;

  @override
  void dispose() {
    _name.dispose();
    _unit.dispose();
    _cost.dispose();
    _reorder.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return FormSheet(
      title: _isNew ? 'Add a material' : widget.existing!.name,
      saveLabel: _isNew ? 'Add it' : 'Save',
      busy: _busy,
      onSave: _valid ? _save : null,
      note: _isNew
          ? 'It starts at nothing on the shelf. The first purchase or count is '
              'what puts real stock against it, so nobody inherits a figure '
              'nobody counted.'
          : 'Changing the reorder level changes when it appears as running low. '
              'The quantity itself only moves through a count.',
      children: [
        SheetField(
          label: 'Name',
          controller: _name,
          autofocus: _isNew,
          onChanged: (_) => setState(() {}),
        ),
        SheetField(
          label: 'Unit',
          controller: _unit,
          hint: 'kg, litre, dozen, packet',
          onChanged: (_) => setState(() {}),
        ),
        SheetField(
          label: 'Cost per unit',
          controller: _cost,
          number: true,
          suffix: currencySymbol,
        ),
        SheetField(
          label: 'Tell me when it drops below',
          controller: _reorder,
          number: true,
          suffix: _unit.text.trim(),
        ),
      ],
    );
  }

  Future<void> _save() async {
    setState(() => _busy = true);
    try {
      await saveMaterial(widget.existing?.id, {
        'name': _name.text.trim(),
        'unit': _unit.text.trim(),
        'costPerUnit': double.tryParse(_cost.text.trim()) ?? 0,
        'reorderLevel': double.tryParse(_reorder.text.trim()) ?? 0,
      });
      if (mounted) Navigator.of(context).pop(true);
    } catch (error) {
      if (!mounted) return;
      setState(() => _busy = false);
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text('Could not save: $error')));
    }
  }
}

/// A delivery: one supplier, several materials.
///
/// Lines are built up one at a time rather than shown as a grid of every
/// material — a delivery is usually three or four things, and a form with
/// nine rows of empty boxes invites a typo in the ones nobody meant to fill.
class _PurchaseForm extends StatefulWidget {
  const _PurchaseForm({
    required this.materials,
    required this.rawById,
    required this.user,
  });

  final List<MaterialItem> materials;
  final Map<String, Map<String, dynamic>> rawById;
  final Actor user;

  @override
  State<_PurchaseForm> createState() => _PurchaseFormState();
}

class _PurchaseFormState extends State<_PurchaseForm> {
  final _supplier = TextEditingController();
  final _qty = TextEditingController();
  final _cost = TextEditingController();
  final List<PurchaseLine> _lines = [];
  late MaterialItem _picked = widget.materials.first;
  bool _busy = false;

  int get _total =>
      purchaseTotal([for (final l in _lines) (qty: l.qty, unitCost: l.unitCost)]);

  @override
  void initState() {
    super.initState();
    // The last price paid is nearly always the price paid again.
    _cost.text = '${_picked.costPerUnit.round()}';
  }

  @override
  void dispose() {
    _supplier.dispose();
    _qty.dispose();
    _cost.dispose();
    super.dispose();
  }

  void _addLine() {
    final qty = double.tryParse(_qty.text.trim());
    final cost = double.tryParse(_cost.text.trim());
    if (qty == null || qty <= 0 || cost == null) return;
    final raw = widget.rawById[_picked.id] ?? const {};
    setState(() {
      _lines.add((
        materialId: _picked.id,
        materialName: _picked.name,
        unit: _picked.unit,
        qty: qty,
        unitCost: cost,
        onHandBefore: _picked.onHand,
        receivedSinceCountBefore:
            ((raw['receivedSinceCount'] as num?) ?? 0).toDouble(),
      ));
      _qty.clear();
    });
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;

    return FormSheet(
      title: 'New purchase',
      saveLabel: _lines.isEmpty
          ? 'Add a line first'
          : 'Record ${_lines.length} line${_lines.length == 1 ? '' : 's'} · ${formatMoney(_total)}',
      busy: _busy,
      onSave: _lines.isEmpty ? null : _save,
      note: 'The stock goes on the shelf as part of the same write, so there is '
          'never a delivery recorded without the stock it brought.',
      children: [
        SheetField(label: 'Supplier (optional)', controller: _supplier),
        DropdownButtonFormField<String>(
          initialValue: _picked.id,
          decoration: const InputDecoration(labelText: 'Material'),
          items: [
            for (final m in widget.materials)
              DropdownMenuItem(value: m.id, child: Text('${m.name} (${m.unit})')),
          ],
          onChanged: (id) {
            final next = widget.materials.firstWhere((m) => m.id == id);
            setState(() {
              _picked = next;
              _cost.text = '${next.costPerUnit.round()}';
            });
          },
        ),
        const SizedBox(height: 14),
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: SheetField(
                label: 'How much',
                controller: _qty,
                number: true,
                suffix: _picked.unit,
                onChanged: (_) => setState(() {}),
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: SheetField(
                label: 'Price per ${_picked.unit}',
                controller: _cost,
                number: true,
                suffix: currencySymbol,
                onChanged: (_) => setState(() {}),
              ),
            ),
          ],
        ),
        OutlinedButton.icon(
          onPressed: (double.tryParse(_qty.text.trim()) ?? 0) > 0 ? _addLine : null,
          icon: const Icon(Icons.add, size: 20),
          label: const Text('Add this line'),
        ),
        if (_lines.isNotEmpty) ...[
          const SizedBox(height: 16),
          Panel(children: [
            for (var i = 0; i < _lines.length; i++)
              PanelLine(
                left: _lines[i].materialName,
                detail: '${_tidy(_lines[i].qty)} ${_lines[i].unit}'
                    ' × ${formatMoney(_lines[i].unitCost.round())}',
                right: formatMoney((_lines[i].qty * _lines[i].unitCost).round()),
                trailing: IconButton(
                  icon: Icon(Icons.close, size: 18, color: colors.muted),
                  tooltip: 'Remove this line',
                  onPressed: () => setState(() => _lines.removeAt(i)),
                ),
              ),
            PanelLine(left: 'Total', strong: true, right: formatMoney(_total)),
          ]),
        ],
        const SizedBox(height: 4),
      ],
    );
  }

  Future<void> _save() async {
    setState(() => _busy = true);
    try {
      await recordPurchase(
        items: _lines,
        supplier: _supplier.text.trim().isEmpty ? null : _supplier.text.trim(),
        user: widget.user,
      );
      if (mounted) {
        Navigator.of(context).pop('Purchase recorded — ${formatMoney(_total)}.');
      }
    } catch (error) {
      if (!mounted) return;
      setState(() => _busy = false);
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text('Could not save: $error')));
    }
  }
}
