/// Which outlet this tablet stands in, and which till it is. Asked once, ever.
library;

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';

import '../device.dart';
import '../theme.dart';

class SetupScreen extends StatefulWidget {
  const SetupScreen({super.key, required this.device, required this.onDone});

  final DeviceStore device;
  final ValueChanged<String> onDone;

  @override
  State<SetupScreen> createState() => _SetupScreenState();
}

class _SetupScreenState extends State<SetupScreen> {
  String? _branchId;
  late String _letter = widget.device.letter;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 460),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text('Set up this tablet', style: context.type.titleLarge),
                  const SizedBox(height: 4),
                  Text(
                    'You only do this once.',
                    style: TextStyle(color: context.colors.muted),
                  ),
                  const SizedBox(height: 24),
                  Text(
                    'Which outlet is this tablet in?',
                    style: TextStyle(fontSize: 13, color: context.colors.muted),
                  ),
                  const SizedBox(height: 8),
                  StreamBuilder<QuerySnapshot<Map<String, dynamic>>>(
                    stream: FirebaseFirestore.instance.collection('branches').snapshots(),
                    builder: (context, snap) {
                      if (!snap.hasData) {
                        return const Padding(
                          padding: EdgeInsets.symmetric(vertical: 20),
                          child: Center(child: CircularProgressIndicator()),
                        );
                      }
                      final branches = snap.data!.docs;
                      return Wrap(
                        spacing: 8,
                        runSpacing: 8,
                        children: [
                          for (final b in branches)
                            _Choice(
                              label: (b.data()['name'] ?? b.id) as String,
                              selected: _branchId == b.id,
                              onTap: () => setState(() => _branchId = b.id),
                            ),
                        ],
                      );
                    },
                  ),
                  const SizedBox(height: 24),
                  Text(
                    'Till letter (only matters if this outlet has two tills)',
                    style: TextStyle(fontSize: 13, color: context.colors.muted),
                  ),
                  const SizedBox(height: 8),
                  Wrap(
                    spacing: 8,
                    children: [
                      for (final letter in ['A', 'B', 'C'])
                        _Choice(
                          label: letter,
                          selected: _letter == letter,
                          onTap: () => setState(() => _letter = letter),
                        ),
                    ],
                  ),
                  const SizedBox(height: 28),
                  FilledButton(
                    onPressed: _branchId == null ? null : _save,
                    child: const Text('Save'),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  Future<void> _save() async {
    final id = _branchId!;
    await widget.device.setLetter(_letter);
    await widget.device.setBranchId(id);
    widget.onDone(id);
  }
}

class _Choice extends StatelessWidget {
  const _Choice({required this.label, required this.selected, required this.onTap});

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    return Material(
      color: selected ? colors.ink : Theme.of(context).colorScheme.surface,
      borderRadius: BorderRadius.circular(999),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(999),
        child: Container(
          constraints: const BoxConstraints(minHeight: 44),
          padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 10),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(999),
            border: Border.all(color: selected ? colors.ink : colors.borderStrong),
          ),
          alignment: Alignment.center,
          child: Text(
            label,
            style: TextStyle(
              fontSize: 15,
              fontWeight: selected ? FontWeight.w600 : FontWeight.w500,
              color: selected ? colors.inkText : null,
            ),
          ),
        ),
      ),
    );
  }
}
