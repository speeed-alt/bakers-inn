/// The three lists the owner keeps: what is sold, who sells it, and where.
///
/// The web version is a 44-row table with seven columns. Scrolling that on a
/// phone to check one price is miserable, so here it is a search box first — he
/// almost always wants one item — over rows grouped under their category. The
/// SR code stays on the left because that is the number printed on the shop's
/// own closing sheet and the one staff say out loud.
///
/// Reads only. Editing a price changes what every till charges at the next
/// sync, which is a decision to make at a desk rather than one-handed.
library;

import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';

import '../config.dart';
import '../core/money.dart';
import '../data/writes.dart';
import '../theme.dart';
import '../widgets/sheet.dart';
import '../widgets/shell.dart';

class CatalogScreen extends StatefulWidget {
  const CatalogScreen({super.key, required this.user});

  /// Stamped onto anything this screen changes.
  final Actor user;

  @override
  State<CatalogScreen> createState() => _CatalogScreenState();
}

class _CatalogScreenState extends State<CatalogScreen>
    with SingleTickerProviderStateMixin {
  late final TabController _tabs = TabController(length: 3, vsync: this);
  final _search = TextEditingController();
  final _db = FirebaseFirestore.instance;

  StreamSubscription? _productsSub;
  StreamSubscription? _peopleSub;
  StreamSubscription? _branchesSub;

  List<Map<String, dynamic>> _products = const [];
  List<Map<String, dynamic>> _people = const [];
  List<Map<String, dynamic>> _branches = const [];
  Object? _error;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _search.addListener(() => setState(() {}));

    _productsSub = _db.collection('products').snapshots().listen(
      (snap) {
        if (!mounted) return;
        setState(() {
          _products = snap.docs
              .map((d) => {'id': d.id, ...d.data()})
              .where((p) => p['active'] != false)
              .toList()
            ..sort(_byCategoryThenName);
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

    _peopleSub = _db.collection('users').snapshots().listen((snap) {
      if (!mounted) return;
      setState(() => _people = snap.docs.map((d) => {'id': d.id, ...d.data()}).toList());
    }, onError: (Object _) {});

    _branchesSub = _db.collection('branches').snapshots().listen((snap) {
      if (!mounted) return;
      setState(() => _branches = snap.docs.map((d) => {'id': d.id, ...d.data()}).toList());
    }, onError: (Object _) {});
  }

  static int _byCategoryThenName(Map<String, dynamic> a, Map<String, dynamic> b) {
    final byCategory =
        ((a['category'] ?? '') as String).compareTo((b['category'] ?? '') as String);
    if (byCategory != 0) return byCategory;
    return ((a['name'] ?? '') as String).compareTo((b['name'] ?? '') as String);
  }

  @override
  void dispose() {
    _productsSub?.cancel();
    _peopleSub?.cancel();
    _branchesSub?.cancel();
    _tabs.dispose();
    _search.dispose();
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
    if (_loading) return const LoadingNote(text: 'Reading the catalog…');

    final colors = context.colors;
    return Column(
      children: [
        TabBar(
          controller: _tabs,
          labelColor: colors.ink,
          unselectedLabelColor: colors.muted,
          indicatorColor: colors.ink,
          indicatorSize: TabBarIndicatorSize.tab,
          dividerColor: colors.border,
          labelStyle: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600),
          unselectedLabelStyle: const TextStyle(fontSize: 15),
          tabs: [
            Tab(text: 'Products (${_products.length})'),
            Tab(text: 'People (${_people.length})'),
            Tab(text: 'Outlets (${_branches.length})'),
          ],
        ),
        Expanded(
          child: TabBarView(
            controller: _tabs,
            children: [_products_(), _people_(), _branches_()],
          ),
        ),
      ],
    );
  }

  Widget _products_() {
    final colors = context.colors;
    final term = _search.text.trim().toLowerCase();
    final matches = term.isEmpty
        ? _products
        : _products.where((p) {
            final name = ((p['name'] ?? '') as String).toLowerCase();
            final code = ((p['code'] ?? '') as String).toLowerCase();
            // An exact code wins, but a partial one narrows — the same rule the
            // till search uses, so the two behave alike.
            return code == term || code.startsWith(term) || name.contains(term);
          }).toList();

    // Group under category headings, but only when browsing. A search result of
    // three items does not need three headings over it.
    final grouped = <String, List<Map<String, dynamic>>>{};
    for (final p in matches) {
      grouped.putIfAbsent((p['category'] ?? 'Other') as String, () => []).add(p);
    }

    return ListView(
      padding: const EdgeInsets.fromLTRB(20, 16, 20, 40),
      children: [
        TextField(
          controller: _search,
          decoration: InputDecoration(
            hintText: 'Search by code or name',
            prefixIcon: const Icon(Icons.search, size: 20),
            suffixIcon: term.isEmpty
                ? null
                : IconButton(
                    icon: const Icon(Icons.close, size: 20),
                    onPressed: _search.clear,
                    tooltip: 'Clear',
                  ),
          ),
        ),
        const SizedBox(height: 12),
        OutlinedButton.icon(
          onPressed: () => _editProduct(null),
          icon: const Icon(Icons.add, size: 20),
          label: const Text('Add a product'),
        ),
        const SizedBox(height: 16),
        if (matches.isEmpty)
          const Panel(children: [EmptyNote('Nothing matches that.')])
        else if (term.isNotEmpty)
          Panel(children: [for (final p in matches) _productLine(p)])
        else
          for (final entry in grouped.entries) ...[
            SectionTitle(entry.key, aside: '${entry.value.length}'),
            Panel(children: [for (final p in entry.value) _productLine(p)]),
            const SizedBox(height: 20),
          ],
        const SizedBox(height: 4),
        Text(
          'Prices and codes are changed on the shop tablet. A change reaches '
          'every till at the next sync; past sales keep the price they were '
          'actually rung at.',
          style: TextStyle(fontSize: 13, color: colors.muted, height: 1.45),
        ),
      ],
    );
  }

  Widget _productLine(Map<String, dynamic> p) {
    final keeps = p['sellsNextDay'] == true;
    return PanelLine(
      leading: SizedBox(
        width: 26,
        child: Text(
          (p['code'] ?? '') as String,
          style: TextStyle(
            fontSize: 13,
            color: context.colors.muted,
            fontFeatures: const [FontFeature.tabularFigures()],
          ),
        ),
      ),
      left: (p['name'] ?? '') as String,
      // "same day" is the one that costs money — it means anything unsold is
      // counted as stale tonight — so it is the one worth saying.
      detail: keeps ? 'keeps' : 'same day',
      right: formatMoney(((p['price'] as num?) ?? 0).round()),
      trailing: Icon(Icons.chevron_right, size: 20, color: context.colors.muted),
      onTap: () => _editProduct(p),
    );
  }

  Future<void> _editProduct(Map<String, dynamic>? existing) async {
    final saved = await openSheet<bool>(
      context,
      _ProductForm(existing: existing, takenCodes: {
        for (final p in _products)
          if (p['id'] != existing?['id']) ((p['code'] ?? '') as String),
      }),
    );
    if (saved == true && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Saved. Every till picks it up at the next sync.')),
      );
    }
  }

  Widget _people_() {
    final byBranch = <String, List<Map<String, dynamic>>>{};
    for (final person in _people) {
      byBranch.putIfAbsent((person['branchId'] ?? '?') as String, () => []).add(person);
    }

    String branchName(String id) {
      for (final b in _branches) {
        if (b['id'] == id) return (b['name'] ?? id) as String;
      }
      return id;
    }

    return ListView(
      padding: const EdgeInsets.fromLTRB(20, 20, 20, 40),
      children: [
        if (_people.isEmpty)
          const Panel(children: [EmptyNote('Nobody added yet.')])
        else
          for (final entry in byBranch.entries) ...[
            SectionTitle(branchName(entry.key)),
            Panel(children: [
              for (final person in entry.value)
                PanelLine(
                  left: (person['name'] ?? '') as String,
                  detail: (person['role'] ?? '') as String,
                  note: person['active'] == false ? 'turned off' : null,
                  trailing: Switch(
                    value: person['active'] != false,
                    onChanged: (on) => _setPersonActive(person, on),
                  ),
                ),
            ]),
            const SizedBox(height: 20),
          ],
        Text(
          'Turning somebody off takes them off every login list. It does not '
          'end a session already open on a tablet — sign that tablet out by '
          'hand if it matters today. Adding a new person, and setting a PIN, '
          'happens on the shop tablet.',
          style: TextStyle(
            fontSize: 13,
            color: context.colors.muted,
            height: 1.45,
          ),
        ),
      ],
    );
  }

  Future<void> _setPersonActive(Map<String, dynamic> person, bool on) async {
    // Never yourself. Turning off the account you are signed in as is a locked
    // door with the key inside — and nothing else in this app could undo it.
    if (person['id'] == widget.user.id) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('You cannot turn off your own account.')),
      );
      return;
    }
    try {
      await setUserActive((person['id'] ?? '') as String, active: on);
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text('Could not save: $error')));
    }
  }

  Widget _branches_() {
    return ListView(
      padding: const EdgeInsets.fromLTRB(20, 20, 20, 40),
      children: [
        Panel(children: [
          if (_branches.isEmpty)
            const EmptyNote('No outlets yet.')
          else
            for (final b in _branches)
              PanelLine(
                left: (b['name'] ?? b['id']) as String,
                detail: b['isMain'] == true
                    ? 'the hub — buys, bakes and sends out'
                    : 'shop — orders, sells and reports back',
                note: (b['id'] ?? '') as String,
              ),
        ]),
      ],
    );
  }
}

/// Add or change one product.
///
/// The code is the number already printed on the shop's own closing sheet, and
/// staff have read those for years — so it is checked for clashes rather than
/// generated, and two products can never share one. A duplicate would make the
/// till ambiguous about which item was just rung up.
class _ProductForm extends StatefulWidget {
  const _ProductForm({required this.existing, required this.takenCodes});

  final Map<String, dynamic>? existing;
  final Set<String> takenCodes;

  @override
  State<_ProductForm> createState() => _ProductFormState();
}

class _ProductFormState extends State<_ProductForm> {
  late final _code = TextEditingController(
      text: (widget.existing?['code'] ?? '') as String);
  late final _name = TextEditingController(
      text: (widget.existing?['name'] ?? '') as String);
  late final _price = TextEditingController(
      text: widget.existing == null
          ? ''
          : '${((widget.existing!['price'] as num?) ?? 0).round()}');

  late String _category =
      (widget.existing?['category'] ?? productCategories.first) as String;
  late bool _keeps = widget.existing?['sellsNextDay'] == true;
  bool _busy = false;

  bool get _isNew => widget.existing == null;
  String? get _codeClash =>
      widget.takenCodes.contains(_code.text.trim()) ? 'That code is already used' : null;

  bool get _valid =>
      _code.text.trim().isNotEmpty &&
      _name.text.trim().isNotEmpty &&
      (int.tryParse(_price.text.trim()) ?? -1) >= 0 &&
      _codeClash == null;

  @override
  void dispose() {
    _code.dispose();
    _name.dispose();
    _price.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final archived = widget.existing?['active'] == false;

    return FormSheet(
      title: _isNew ? 'Add a product' : (widget.existing!['name'] as String),
      saveLabel: _isNew ? 'Add it' : 'Save',
      busy: _busy,
      onSave: _valid ? _save : null,
      note: 'A price change reaches every till at the next sync. Sales already '
          'rung up keep the price they were sold at, so old receipts and '
          'reports do not move.',
      destructive: _isNew
          ? null
          : OutlinedButton(
              onPressed: _busy ? null : () => _archive(!archived),
              child: Text(archived ? 'Put back on sale' : 'Archive it'),
            ),
      children: [
        SheetField(
          label: 'Code',
          controller: _code,
          hint: 'the SR number on the printed sheet',
          autofocus: _isNew,
          onChanged: (_) => setState(() {}),
        ),
        if (_codeClash != null)
          Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: Text(_codeClash!,
                style: TextStyle(fontSize: 13, color: context.colors.alert)),
          ),
        SheetField(
          label: 'Name',
          controller: _name,
          onChanged: (_) => setState(() {}),
        ),
        SheetField(
          label: 'Price',
          controller: _price,
          number: true,
          suffix: currencySymbol,
          onChanged: (_) => setState(() {}),
        ),
        SheetChoice<String>(
          label: 'Category',
          value: _category,
          options: [
            for (final c in productCategories) (value: c, label: c),
          ],
          onChanged: (c) => setState(() => _category = c),
        ),
        SheetChoice<bool>(
          label: 'Left over at closing',
          value: _keeps,
          options: const [
            (value: false, label: 'Counted as stale'),
            (value: true, label: 'Keeps till tomorrow'),
          ],
          onChanged: (v) => setState(() => _keeps = v),
        ),
      ],
    );
  }

  Future<void> _save() async {
    setState(() => _busy = true);
    try {
      await saveProduct(widget.existing?['id'] as String?, {
        'code': _code.text.trim(),
        'name': _name.text.trim(),
        'category': _category,
        'price': int.parse(_price.text.trim()),
        'sellsNextDay': _keeps,
      });
      if (mounted) Navigator.of(context).pop(true);
    } catch (error) {
      if (!mounted) return;
      setState(() => _busy = false);
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text('Could not save: $error')));
    }
  }

  /// Archived, never deleted — a receipt from March still has to render with
  /// the name and price it was rung at.
  Future<void> _archive(bool archived) async {
    setState(() => _busy = true);
    try {
      await archiveProduct(widget.existing!['id'] as String, archived: archived);
      if (mounted) Navigator.of(context).pop(true);
    } catch (error) {
      if (!mounted) return;
      setState(() => _busy = false);
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text('Could not save: $error')));
    }
  }
}
