/// The handful of shapes every owner screen is built from.
///
/// Extracted so the dashboard, materials and catalog cannot drift into looking
/// like three different apps. There is no card shadow, no accent colour and no
/// tinted surface here on purpose — the owner asked for "minimalistically
/// professional, nothing flashy", so hierarchy comes from weight, size and space.
///
/// The one deliberate departure from the web app: **no data tables**. A table
/// with five columns is fine on a counter tablet and unreadable on a phone held
/// in one hand, so every table becomes a list of rows with the figure that
/// matters pushed to the right.
library;

import 'package:flutter/material.dart';

import '../theme.dart';

/// A heading and its optional aside, above a panel.
class SectionTitle extends StatelessWidget {
  const SectionTitle(this.title, {super.key, this.aside, this.action});

  final String title;
  final String? aside;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          Expanded(child: Text(title, style: context.type.titleMedium)),
          if (aside != null)
            Text(
              aside!,
              style: TextStyle(fontSize: 13, color: context.colors.muted),
            ),
          ?action,
        ],
      ),
    );
  }
}

/// A bordered box whose children are separated by hairlines rather than by gaps,
/// so a run of figures reads as one block instead of as scattered cards.
class Panel extends StatelessWidget {
  const Panel({super.key, required this.children});

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

/// One row inside a [Panel]: a label, an optional second line, and the figure.
class PanelLine extends StatelessWidget {
  const PanelLine({
    super.key,
    required this.left,
    this.right,
    this.detail,
    this.note,
    this.noteIsAlert = false,
    this.muted = false,
    this.strong = false,
    this.leading,
    this.trailing,
    this.onTap,
  });

  final String left;
  final String? right;
  final String? detail;
  final String? note;
  final bool noteIsAlert;
  final bool muted;

  /// For a total line, where the figure is the answer rather than one of many.
  final bool strong;
  final Widget? leading;
  final Widget? trailing;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;

    final body = Padding(
      padding: const EdgeInsets.symmetric(horizontal: 15, vertical: 13),
      child: Row(
        children: [
          if (leading != null) ...[leading!, const SizedBox(width: 12)],
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  left,
                  style: TextStyle(
                    fontSize: 15,
                    height: 1.35,
                    fontWeight: strong ? FontWeight.w600 : FontWeight.w400,
                    color: muted ? colors.muted : null,
                  ),
                ),
                if (detail != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 2),
                    child: Text(
                      detail!,
                      style: TextStyle(
                        fontSize: 13,
                        height: 1.35,
                        color: colors.muted,
                      ),
                    ),
                  ),
              ],
            ),
          ),
          if (note != null) ...[
            const SizedBox(width: 10),
            Text(
              note!,
              style: TextStyle(
                fontSize: 13,
                color: noteIsAlert ? colors.alert : colors.muted,
              ),
            ),
          ],
          if (right != null) ...[
            const SizedBox(width: 12),
            Text(
              right!,
              style: TextStyle(
                fontSize: strong ? 17 : 15,
                fontWeight: FontWeight.w600,
                fontFeatures: const [FontFeature.tabularFigures()],
              ),
            ),
          ],
          if (trailing != null) ...[const SizedBox(width: 4), trailing!],
        ],
      ),
    );

    if (onTap == null) return body;
    return InkWell(onTap: onTap, child: body);
  }
}

/// The figures the owner reads first, divided by hairlines rather than boxed.
///
/// Two per row on a phone. Three would fit the characters but not the eye —
/// "Rs 128,400" at 22px needs the width to stay on one line, and a wrapped
/// rupee figure reads as two numbers.
class StatGrid extends StatelessWidget {
  const StatGrid({super.key, required this.stats});

  final List<({String label, String value})> stats;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    final width = MediaQuery.sizeOf(context).width;
    final perRow = width >= 620 ? stats.length.clamp(1, 4) : 2;

    return LayoutBuilder(
      builder: (context, constraints) {
        // Subtract the container's own 1px border on each side before dividing.
        // Without that the cells come to two pixels more than the Wrap actually
        // has, so the second one wraps and every stat ends up on its own row
        // with a dead strip of border colour down the other half of the card.
        // Floored for the same reason: a fraction of a pixel over is still over.
        final inner = constraints.maxWidth - 2;
        final cell = ((inner - (perRow - 1)) / perRow).floorToDouble();
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
                Container(
                  width: cell,
                  color: Theme.of(context).colorScheme.surface,
                  padding: const EdgeInsets.fromLTRB(15, 13, 15, 14),
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
                      const SizedBox(height: 4),
                      FittedBox(
                        fit: BoxFit.scaleDown,
                        alignment: Alignment.centerLeft,
                        child: Text(
                          stat.value,
                          maxLines: 1,
                          style: const TextStyle(
                            fontSize: 24,
                            fontWeight: FontWeight.w600,
                            fontFeatures: [FontFeature.tabularFigures()],
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
            ],
          ),
        );
      },
    );
  }
}

/// A denied read looks exactly like an empty day unless it is said out loud.
class ProblemNote extends StatelessWidget {
  const ProblemNote({super.key, required this.message, this.title});

  final String message;
  final String? title;

  @override
  Widget build(BuildContext context) {
    return Panel(
      children: [
        Padding(
          padding: const EdgeInsets.all(15),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(title ?? 'Could not read this',
                  style: context.type.titleMedium),
              const SizedBox(height: 6),
              Text(
                message,
                style: TextStyle(fontSize: 13, color: context.colors.muted),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

/// Says why a panel is empty, rather than leaving a blank box that reads as a
/// fault.
class EmptyNote extends StatelessWidget {
  const EmptyNote(this.text, {super.key});

  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 15, vertical: 22),
      child: Center(
        child: Text(
          text,
          textAlign: TextAlign.center,
          style: TextStyle(fontSize: 14, color: context.colors.muted),
        ),
      ),
    );
  }
}

/// A spinner with words next to it.
///
/// A bare spinner on a dark screen is indistinguishable from a screen that has
/// hung, and the honest answer here is usually "the phone is on shop wifi and
/// this is the first read of the day". Saying what is being fetched turns a
/// suspicious pause into an explained one.
class LoadingNote extends StatelessWidget {
  const LoadingNote({super.key, this.text = 'Loading…'});

  final String text;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const SizedBox(
              width: 22,
              height: 22,
              child: CircularProgressIndicator(strokeWidth: 2),
            ),
            const SizedBox(height: 14),
            Text(
              text,
              textAlign: TextAlign.center,
              style: TextStyle(fontSize: 14, color: context.colors.muted),
            ),
          ],
        ),
      ),
    );
  }
}

class PanelLoading extends StatelessWidget {
  const PanelLoading({super.key, this.text = 'Loading…'});

  final String text;

  @override
  Widget build(BuildContext context) {
    return Panel(children: [LoadingNote(text: text)]);
  }
}
