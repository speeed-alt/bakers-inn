/// What the owner wants to know without ringing anybody: what came in today,
/// which shop it came from, and which days have been closed.
///
/// Reads only. Every figure here is added up from the sales the outlets wrote —
/// nothing on this screen can change a record, which is why it is safe for the
/// owner to open it on a phone in a car.
library;

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';

import '../auth.dart';
import '../core/dates.dart';
import '../core/money.dart';
import '../theme.dart';

class DashboardScreen extends StatelessWidget {
  const DashboardScreen({super.key, required this.auth});

  final AuthController auth;

  @override
  Widget build(BuildContext context) {
    final today = businessDateOf();

    return StreamBuilder<QuerySnapshot<Map<String, dynamic>>>(
      stream: FirebaseFirestore.instance
          .collection('sales')
          .where('businessDate', isEqualTo: today)
          .snapshots(),
      builder: (context, snap) {
        if (snap.hasError) {
          return _Problem(message: '${snap.error}');
        }
        if (!snap.hasData) {
          return const Center(child: CircularProgressIndicator());
        }

        // A voided sale is still a record — it is simply not money. Refunds keep
        // their negative total, so adding everything up is the whole story.
        final live = snap.data!.docs
            .map((d) => d.data())
            .where((s) => s['status'] != 'voided')
            .toList();

        int sumWhere(bool Function(Map<String, dynamic>) test) => live
            .where(test)
            .fold(0, (running, s) => running + ((s['total'] as num?) ?? 0).round());

        final takings = sumWhere((_) => true);
        final cash = sumWhere((s) => s['payment'] == 'cash');
        final card = sumWhere((s) => s['payment'] == 'card');

        final byBranch = <String, ({int total, int count})>{};
        for (final sale in live) {
          final branch = (sale['branchId'] ?? '?') as String;
          final current = byBranch[branch] ?? (total: 0, count: 0);
          byBranch[branch] = (
            total: current.total + ((sale['total'] as num?) ?? 0).round(),
            count: current.count + 1,
          );
        }

        return ListView(
          padding: const EdgeInsets.all(20),
          children: [
            Text('Today', style: context.type.titleLarge),
            Text(formatDate(today), style: TextStyle(color: context.colors.muted)),
            const SizedBox(height: 14),
            _StatRow(
              stats: [
                (label: 'Takings', value: formatMoney(takings)),
                (label: 'Cash', value: formatMoney(cash)),
                (label: 'Card', value: formatMoney(card)),
                (label: 'Sales', value: '${live.length}'),
              ],
            ),
            const SizedBox(height: 24),
            Text('By outlet today', style: context.type.titleMedium),
            const SizedBox(height: 10),
            _Panel(
              children: [
                if (byBranch.isEmpty)
                  _Line(
                    left: 'Nothing rung up yet',
                    right: formatMoney(0),
                    muted: true,
                  )
                else
                  for (final entry in byBranch.entries)
                    _Line(
                      left: entry.key,
                      detail: '${entry.value.count} sales',
                      right: formatMoney(entry.value.total),
                    ),
              ],
            ),
            const SizedBox(height: 24),
            Text('Recent closes', style: context.type.titleMedium),
            const SizedBox(height: 10),
            const _RecentCloses(),
          ],
        );
      },
    );
  }
}

class _RecentCloses extends StatelessWidget {
  const _RecentCloses();

  @override
  Widget build(BuildContext context) {
    return StreamBuilder<QuerySnapshot<Map<String, dynamic>>>(
      stream: FirebaseFirestore.instance
          .collection('closings')
          .orderBy('businessDate', descending: true)
          .limit(9)
          .snapshots(),
      builder: (context, snap) {
        if (snap.hasError) return _Problem(message: '${snap.error}');
        if (!snap.hasData) {
          return const Padding(
            padding: EdgeInsets.symmetric(vertical: 20),
            child: Center(child: CircularProgressIndicator()),
          );
        }
        final closes = snap.data!.docs;
        if (closes.isEmpty) {
          return _Panel(
            children: [_Line(left: 'No days closed yet.', right: '', muted: true)],
          );
        }
        return _Panel(
          children: [
            for (final doc in closes)
              Builder(
                builder: (context) {
                  final data = doc.data();
                  final over = ((data['overShort'] as num?) ?? 0).round();
                  return _Line(
                    left: (data['businessDate'] ?? '') as String,
                    detail: (data['branchId'] ?? '') as String,
                    right: formatMoney(((data['takings'] as num?) ?? 0).round()),
                    // Over or short is the one number on this screen that is
                    // allowed to be red, and only when it is not zero.
                    note: over == 0 ? null : formatMoney(over),
                    noteIsAlert: over != 0,
                  );
                },
              ),
          ],
        );
      },
    );
  }
}

class _StatRow extends StatelessWidget {
  const _StatRow({required this.stats});

  final List<({String label, String value})> stats;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    return Container(
      decoration: BoxDecoration(
        color: colors.border,
        borderRadius: BorderRadius.circular(kRadius),
        border: Border.all(color: colors.border),
      ),
      clipBehavior: Clip.antiAlias,
      child: Wrap(
        spacing: 1,
        runSpacing: 1,
        children: [
          for (final stat in stats)
            LayoutBuilder(
              builder: (context, _) => Container(
                width: _cellWidth(context, stats.length),
                color: Theme.of(context).colorScheme.surface,
                padding: const EdgeInsets.symmetric(horizontal: 15, vertical: 13),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      stat.label.toUpperCase(),
                      style: TextStyle(
                        fontSize: 12,
                        letterSpacing: 0.7,
                        fontWeight: FontWeight.w600,
                        color: colors.muted,
                      ),
                    ),
                    const SizedBox(height: 3),
                    Text(
                      stat.value,
                      style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w600),
                    ),
                  ],
                ),
              ),
            ),
        ],
      ),
    );
  }

  /// Fit as many cells per row as will hold a rupee figure without wrapping,
  /// down to two on a narrow phone.
  double _cellWidth(BuildContext context, int count) {
    final available = MediaQuery.sizeOf(context).width - 40 - 2;
    final perRow = available >= 560 ? count : 2;
    return (available - (perRow - 1)) / perRow;
  }
}

class _Panel extends StatelessWidget {
  const _Panel({required this.children});

  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    return Container(
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surface,
        borderRadius: BorderRadius.circular(kRadius),
        border: Border.all(color: colors.border),
      ),
      clipBehavior: Clip.antiAlias,
      child: Column(
        children: [
          for (var i = 0; i < children.length; i++) ...[
            if (i > 0) Divider(height: 1, color: colors.border),
            children[i],
          ],
        ],
      ),
    );
  }
}

class _Line extends StatelessWidget {
  const _Line({
    required this.left,
    required this.right,
    this.detail,
    this.note,
    this.noteIsAlert = false,
    this.muted = false,
  });

  final String left;
  final String right;
  final String? detail;
  final String? note;
  final bool noteIsAlert;
  final bool muted;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 15, vertical: 12),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  left,
                  style: TextStyle(
                    fontSize: 15,
                    color: muted ? colors.muted : null,
                  ),
                ),
                if (detail != null)
                  Text(
                    detail!,
                    style: TextStyle(fontSize: 13, color: colors.muted),
                  ),
              ],
            ),
          ),
          if (note != null) ...[
            Text(
              note!,
              style: TextStyle(
                fontSize: 13,
                color: noteIsAlert ? colors.alert : colors.muted,
              ),
            ),
            const SizedBox(width: 12),
          ],
          Text(
            right,
            style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600),
          ),
        ],
      ),
    );
  }
}

/// A denied read looks exactly like an empty day unless it is said out loud.
class _Problem extends StatelessWidget {
  const _Problem({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Text('Could not read this', style: context.type.titleMedium),
          const SizedBox(height: 6),
          Text(message, style: TextStyle(fontSize: 13, color: context.colors.muted)),
        ],
      ),
    );
  }
}
