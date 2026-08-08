/// Tap your name, then four digits. No keyboard, no email address, nothing to
/// remember beyond the PIN.
library;

import 'package:flutter/material.dart';

import '../auth.dart';
import '../theme.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({
    super.key,
    required this.auth,
    required this.branchId,
    required this.onChangeOutlet,
  });

  final AuthController auth;
  final String branchId;
  final VoidCallback onChangeOutlet;

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  StaffOption? _person;
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
            child: Padding(
              padding: const EdgeInsets.all(24),
              child: _person == null ? _chooseName() : _enterPin(),
            ),
          ),
        ),
      ),
    );
  }

  Widget _chooseName() {
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(widget.branchId, style: context.type.titleLarge),
        const SizedBox(height: 4),
        Text(
          'Tap your name to start.',
          style: TextStyle(color: context.colors.muted),
        ),
        const SizedBox(height: 20),
        StreamBuilder<List<StaffOption>>(
          stream: widget.auth.staffAt(widget.branchId),
          builder: (context, snap) {
            if (!snap.hasData) {
              return const Padding(
                padding: EdgeInsets.symmetric(vertical: 24),
                child: Center(child: CircularProgressIndicator()),
              );
            }
            final people = snap.data!;
            if (people.isEmpty) {
              return Text(
                'Nobody is set up at this outlet yet.',
                style: TextStyle(color: context.colors.muted),
              );
            }
            return Column(
              children: [
                for (final person in people)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 8),
                    child: OutlinedButton(
                      onPressed: () => setState(() {
                        _person = person;
                        _pin = '';
                        _error = null;
                      }),
                      child: Row(
                        children: [
                          Text(person.name),
                          const Spacer(),
                          Text(
                            person.role,
                            style: TextStyle(fontSize: 13, color: context.colors.muted),
                          ),
                        ],
                      ),
                    ),
                  ),
              ],
            );
          },
        ),
        const SizedBox(height: 8),
        TextButton(
          onPressed: widget.onChangeOutlet,
          child: Text('This tablet is not at ${widget.branchId}'),
        ),
      ],
    );
  }

  Widget _enterPin() {
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text('Hello ${_person!.name}', style: context.type.titleLarge),
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
        // A keypad rather than a text field: gloved or floury hands, and no
        // system keyboard sliding over the screen mid-rush.
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
                          onPressed: _busy ? null : () => _press(key),
                          child: Text(key, style: const TextStyle(fontSize: 20)),
                        ),
                      ),
                    ),
                  ),
              ],
            ),
          ),
        const SizedBox(height: 8),
        TextButton(
          onPressed: _busy ? null : () => setState(() => _person = null),
          child: const Text('Not you? Go back'),
        ),
      ],
    );
  }

  Future<void> _press(String key) async {
    if (key == '✕') {
      setState(() => _person = null);
      return;
    }
    if (key == '⌫') {
      if (_pin.isNotEmpty) setState(() => _pin = _pin.substring(0, _pin.length - 1));
      return;
    }
    if (_pin.length >= 4) return;

    final pin = _pin + key;
    setState(() {
      _pin = pin;
      _error = null;
    });

    // Sign in the moment the fourth digit lands — there is no "go" button to
    // hunt for with a queue waiting.
    if (pin.length == 4) {
      setState(() => _busy = true);
      final failure = await widget.auth.signIn(_person!.uid, pin);
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
