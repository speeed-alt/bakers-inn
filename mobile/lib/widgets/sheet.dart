/// Short forms, in a sheet that comes up from the bottom.
///
/// A sheet rather than a new screen: everything the owner edits here is two or
/// three fields, and a sheet keeps the list he was reading visible behind it, so
/// he can see which material he tapped while he types.
///
/// Every form ends with one full-width primary action. There is no cancel
/// button — the sheet is dismissed by swiping it away or tapping outside, which
/// is what a thumb does anyway.
library;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../theme.dart';

/// Open [child] as a form sheet. Returns whatever the form pops with.
Future<T?> openSheet<T>(BuildContext context, Widget child) {
  return showModalBottomSheet<T>(
    context: context,
    isScrollControlled: true,
    backgroundColor: Theme.of(context).colorScheme.surface,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(14)),
    ),
    builder: (_) => child,
  );
}

class FormSheet extends StatelessWidget {
  const FormSheet({
    super.key,
    required this.title,
    required this.children,
    required this.saveLabel,
    this.onSave,
    this.busy = false,
    this.note,
    this.destructive,
  });

  final String title;
  final List<Widget> children;
  final String saveLabel;

  /// Null disables the button — used while a required field is empty.
  final VoidCallback? onSave;
  final bool busy;
  final String? note;

  /// A second, quieter action: archive, turn off. Never a delete.
  final Widget? destructive;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    return SafeArea(
      child: Padding(
        // Lift the sheet above the keyboard rather than letting it cover the
        // field being typed into.
        padding: EdgeInsets.only(
          left: 20,
          right: 20,
          top: 18,
          bottom: MediaQuery.viewInsetsOf(context).bottom + 20,
        ),
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Center(
                child: Container(
                  width: 36,
                  height: 4,
                  margin: const EdgeInsets.only(bottom: 16),
                  decoration: BoxDecoration(
                    color: colors.border,
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
              ),
              Text(title, style: context.type.titleLarge),
              const SizedBox(height: 16),
              ...children,
              if (note != null) ...[
                const SizedBox(height: 4),
                Text(
                  note!,
                  style: TextStyle(
                    fontSize: 13,
                    height: 1.45,
                    color: colors.muted,
                  ),
                ),
              ],
              const SizedBox(height: 18),
              FilledButton(
                onPressed: busy ? null : onSave,
                child: Text(busy ? 'Saving…' : saveLabel),
              ),
              if (destructive != null) ...[
                const SizedBox(height: 8),
                destructive!,
              ],
            ],
          ),
        ),
      ),
    );
  }
}

/// A labelled field. Kept here so every form spaces and labels the same way.
class SheetField extends StatelessWidget {
  const SheetField({
    super.key,
    required this.label,
    required this.controller,
    this.hint,
    this.number = false,
    this.autofocus = false,
    this.suffix,
    this.onChanged,
  });

  final String label;
  final TextEditingController controller;
  final String? hint;
  final bool number;
  final bool autofocus;
  final String? suffix;
  final ValueChanged<String>? onChanged;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 14),
      child: TextField(
        controller: controller,
        autofocus: autofocus,
        onChanged: onChanged,
        keyboardType: number
            ? const TextInputType.numberWithOptions(decimal: true)
            : TextInputType.text,
        inputFormatters: number
            ? [FilteringTextInputFormatter.allow(RegExp(r'[0-9.]'))]
            : null,
        decoration: InputDecoration(
          labelText: label,
          hintText: hint,
          suffixText: suffix,
        ),
      ),
    );
  }
}

/// A row of choices, one selected. Plainer than a dropdown and reachable with
/// one thumb, which matters more than saving the vertical space would.
class SheetChoice<T> extends StatelessWidget {
  const SheetChoice({
    super.key,
    required this.label,
    required this.value,
    required this.options,
    required this.onChanged,
  });

  final String label;
  final T value;
  final List<({T value, String label})> options;
  final ValueChanged<T> onChanged;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    return Padding(
      padding: const EdgeInsets.only(bottom: 14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: TextStyle(fontSize: 13, color: colors.muted)),
          const SizedBox(height: 8),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              for (final option in options)
                _Chip(
                  label: option.label,
                  on: option.value == value,
                  onTap: () => onChanged(option.value),
                ),
            ],
          ),
        ],
      ),
    );
  }
}

class _Chip extends StatelessWidget {
  const _Chip({required this.label, required this.on, required this.onTap});

  final String label;
  final bool on;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(999),
      child: Container(
        constraints: const BoxConstraints(minHeight: 42),
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 9),
        decoration: BoxDecoration(
          color: on ? colors.ink : Theme.of(context).colorScheme.surface,
          borderRadius: BorderRadius.circular(999),
          border: Border.all(color: on ? colors.ink : colors.borderStrong),
        ),
        child: Text(
          label,
          style: TextStyle(
            fontSize: 15,
            fontWeight: on ? FontWeight.w600 : FontWeight.w400,
            color: on ? colors.inkText : null,
          ),
        ),
      ),
    );
  }
}
