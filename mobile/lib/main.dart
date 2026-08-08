import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/material.dart';

import 'auth.dart';
import 'device.dart';
import 'firebase_options.dart';
import 'screens/dashboard.dart';
import 'screens/login.dart';
import 'screens/setup.dart';
import 'theme.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await Firebase.initializeApp(options: DefaultFirebaseOptions.currentPlatform);

  // Selling has to work with no internet, so reads come from a local cache and
  // writes queue on the device until the connection returns. Unlimited cache
  // because the alternative — silently evicting a queued sale — is money.
  FirebaseFirestore.instance.settings = const Settings(
    persistenceEnabled: true,
    cacheSizeBytes: Settings.CACHE_SIZE_UNLIMITED,
  );

  final theme = await ThemeController.load();
  final device = await DeviceStore.load();
  runApp(BakeryApp(theme: theme, device: device));
}

class BakeryApp extends StatelessWidget {
  const BakeryApp({super.key, required this.theme, required this.device});

  final ThemeController theme;
  final DeviceStore device;

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: theme,
      builder: (context, _) => MaterialApp(
        title: "The Baker's Inn",
        debugShowCheckedModeBanner: false,
        theme: bakeryLight,
        darkTheme: bakeryDark,
        themeMode: theme.mode,
        home: Root(theme: theme, device: device),
      ),
    );
  }
}

/// Decides what this tablet should be showing: set itself up, sign somebody in,
/// or get on with the day.
class Root extends StatefulWidget {
  const Root({super.key, required this.theme, required this.device});

  final ThemeController theme;
  final DeviceStore device;

  @override
  State<Root> createState() => _RootState();
}

class _RootState extends State<Root> {
  late final AuthController _auth = AuthController();
  String? _branchId;

  @override
  void initState() {
    super.initState();
    _branchId = widget.device.branchId;
  }

  @override
  void dispose() {
    _auth.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: _auth,
      builder: (context, _) {
        if (_branchId == null) {
          return SetupScreen(
            device: widget.device,
            onDone: (id) => setState(() => _branchId = id),
          );
        }
        if (_auth.loading) {
          return const Scaffold(body: Center(child: CircularProgressIndicator()));
        }
        if (_auth.user == null) {
          return LoginScreen(
            auth: _auth,
            branchId: _branchId!,
            onChangeOutlet: () async {
              await widget.device.clearBranchId();
              setState(() => _branchId = null);
            },
          );
        }
        return HomeScreen(
          auth: _auth,
          theme: widget.theme,
          device: widget.device,
          branchId: _branchId!,
        );
      },
    );
  }
}

/// The signed-in shell. Which screen sits inside it is decided by the role on
/// the person's own record — the same rule as the web app.
class HomeScreen extends StatelessWidget {
  const HomeScreen({
    super.key,
    required this.auth,
    required this.theme,
    required this.device,
    required this.branchId,
  });

  final AuthController auth;
  final ThemeController theme;
  final DeviceStore device;
  final String branchId;

  @override
  Widget build(BuildContext context) {
    final profile = auth.profile;

    if (profile == null) {
      return _Message(
        title: 'This account has no staff record',
        detail: 'Ask the owner to add you, then sign in again.',
        onSignOut: auth.signOut,
      );
    }

    // Everyone except the owner is pinned to the outlet on their own record, so
    // a sale can never be stamped with the wrong branch by signing in elsewhere.
    if (!profile.isOwner && profile.branchId != branchId) {
      return _Message(
        title: 'Wrong outlet',
        detail:
            'This tablet belongs to $branchId, but you are registered at ${profile.branchId}. '
            'Sign in at your own outlet.',
        onSignOut: auth.signOut,
      );
    }

    return Scaffold(
      appBar: AppBar(
        titleSpacing: 20,
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(profile.name, style: context.type.titleMedium),
            Text(
              '${profile.role} · $branchId · till ${device.letter}',
              style: TextStyle(fontSize: 12, color: context.colors.muted),
            ),
          ],
        ),
        actions: [
          ThemeToggleButton(theme: theme),
          TextButton(onPressed: auth.signOut, child: const Text('Sign out')),
          const SizedBox(width: 8),
        ],
      ),
      body: Column(
        children: [
          if (auth.claimsStale)
            _Banner(
              'This sign-in is out of date, so nothing you enter will save. '
              'Sign out and back in.',
            ),
          Expanded(
            child: profile.isOwner
                ? DashboardScreen(auth: auth)
                : _NotBuiltYet(role: profile.role),
          ),
        ],
      ),
    );
  }
}

class _Banner extends StatelessWidget {
  const _Banner(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      color: context.colors.surface2,
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
      child: Text(text, style: context.type.bodySmall),
    );
  }
}

class _Message extends StatelessWidget {
  const _Message({
    required this.title,
    required this.detail,
    required this.onSignOut,
  });

  final String title;
  final String detail;
  final VoidCallback onSignOut;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 420),
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: context.type.titleLarge),
                const SizedBox(height: 8),
                Text(detail, style: TextStyle(color: context.colors.muted)),
                const SizedBox(height: 20),
                OutlinedButton(onPressed: onSignOut, child: const Text('Sign out')),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// Honest placeholder. The till, close-day, bake and dispatch screens are still
/// being ported; the web app serves those roles in the meantime.
class _NotBuiltYet extends StatelessWidget {
  const _NotBuiltYet({required this.role});

  final String role;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text('Not in the app yet', style: context.type.titleLarge),
            const SizedBox(height: 8),
            Text(
              'The $role screens are still being moved across. '
              'Use the browser app on this tablet for now — it is the same system '
              'and the same figures.',
              textAlign: TextAlign.center,
              style: TextStyle(color: context.colors.muted),
            ),
          ],
        ),
      ),
    );
  }
}
