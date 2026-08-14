/// Four digits, and in.
///
/// This app is the owner's, so there is normally nobody to choose between: it
/// opens straight on "Hello Owner" and the keypad. A list only appears if the
/// business has more than one owner, because then the app genuinely does not
/// know which one is holding the phone.
library;

import 'package:flutter/material.dart';

import '../auth.dart';
import '../theme.dart';
import '../widgets/shell.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key, required this.auth});

  final AuthController auth;

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  /// Only set once somebody has been picked from a list of several. With one
  /// owner it stays null and the person is derived from the stream instead,
  /// which keeps this out of setState-during-build territory.
  StaffOption? _chosen;
  String _pin = '';
  String? _error;
  bool _busy = false;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 420),
            child: StreamBuilder<List<StaffOption>>(
              stream: widget.auth.owners(),
              builder: (context, snap) {
                if (snap.hasError) {
                  return _note(
                    'Could not reach the staff list',
                    'Check the connection and try again.',
                  );
                }
                if (!snap.hasData) {
                  return const LoadingNote(text: 'Starting up…');
                }

                final owners = snap.data!;
                if (owners.isEmpty) {
                  return _note(
                    'No owner is set up yet',
                    'Run the seed against this project, then open the app again.',
                  );
                }

                final person = _chosen ?? (owners.length == 1 ? owners.single : null);
                return Padding(
                  padding: const EdgeInsets.all(24),
                  child: person == null
                      ? _chooseOwner(owners)
                      : _enterPin(person, canGoBack: owners.length > 1),
                );
              },
            ),
          ),
        ),
      ),
    );
  }

  Widget _note(String title, String detail) {
    return Padding(
      padding: const EdgeInsets.all(24),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(title, style: context.type.titleLarge),
          const SizedBox(height: 6),
          Text(detail, style: TextStyle(color: context.colors.muted)),
        ],
      ),
    );
  }

  Widget _chooseOwner(List<StaffOption> owners) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text("Baker's Inn", style: context.type.titleLarge),
        const SizedBox(height: 4),
        Text('Tap your name to start.',
            style: TextStyle(color: context.colors.muted)),
        const SizedBox(height: 20),
        for (final person in owners)
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: OutlinedButton(
              onPressed: () => setState(() {
                _chosen = person;
                _pin = '';
                _error = null;
              }),
              child: Row(
                children: [
                  Text(person.name),
                  const Spacer(),
                  Text(person.role,
                      style: TextStyle(fontSize: 13, color: context.colors.muted)),
                ],
              ),
            ),
          ),
      ],
    );
  }

  Widget _enterPin(StaffOption person, {required bool canGoBack}) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text('Hello ${person.name}', style: context.type.titleLarge),
        const SizedBox(height: 4),
        Text(
          _error ?? 'Enter your 4-digit PIN.',
          style: TextStyle(
            color: _error == null ? context.colors.muted : context.colors.alert,
          ),
        ),
        const SizedBox(height: 18),
        Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            for (var i = 0; i < 4; i++)
              Container(
                width: 14,
                height: 14,
                margin: const EdgeInsets.symmetric(horizontal: 7),
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: i < _pin.length ? context.colors.ink : Colors.transparent,
                  border: Border.all(color: context.colors.borderStrong),
                ),
              ),
          ],
        ),
        const SizedBox(height: 22),
        // A keypad rather than a text field: no system keyboard sliding over the
        // screen, and the digits stay where the thumb last found them.
        for (final row in const [
          ['1', '2', '3'],
          ['4', '5', '6'],
          ['7', '8', '9'],
          ['✕', '0', '⌫'],
        ])
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: Row(
              children: [
                for (final key in row)
                  Expanded(
                    child: Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 4),
                      child: SizedBox(
                        height: 58,
                        child: OutlinedButton(
                          onPressed: _busy ? null : () => _press(key, person),
                          child: Text(key, style: const TextStyle(fontSize: 20)),
                        ),
                      ),
                    ),
                  ),
              ],
            ),
          ),
        if (_busy) ...[
          const SizedBox(height: 10),
          Text(
            'Signing in…',
            textAlign: TextAlign.center,
            style: TextStyle(fontSize: 14, color: context.colors.muted),
          ),
        ],
        if (canGoBack)
          TextButton(
            onPressed: _busy ? null : () => setState(() => _chosen = null),
            child: const Text('Not you? Go back'),
          ),
      ],
    );
  }

  Future<void> _press(String key, StaffOption person) async {
    // ✕ clears the digits rather than going back. With one owner there is
    // nowhere to go back to, and "start this PIN again" is what the key is for.
    if (key == '✕') {
      setState(() {
        _pin = '';
        _error = null;
      });
      return;
    }
    if (key == '⌫') {
      if (_pin.isNotEmpty) {
        setState(() => _pin = _pin.substring(0, _pin.length - 1));
      }
      return;
    }
    if (_pin.length >= 4) return;

    final pin = _pin + key;
    setState(() {
      _pin = pin;
      _error = null;
    });

    // Sign in the moment the fourth digit lands — there is no "go" button to
    // hunt for.
    if (pin.length == 4) {
      setState(() => _busy = true);
      final failure = await widget.auth.signIn(person.uid, pin);
      if (!mounted) return;
      setState(() {
        _busy = false;
        if (failure != null) {
          _error = failure;
          _pin = '';
        }
      });
    }
  }
}
