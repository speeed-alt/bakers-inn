import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/material.dart';

import 'auth.dart';
import 'firebase_options.dart';
import 'screens/catalog.dart';
import 'screens/dashboard.dart';
import 'screens/login.dart';
import 'screens/materials.dart';
import 'theme.dart';
import 'widgets/shell.dart';

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
  runApp(BakeryApp(theme: theme));
}

class BakeryApp extends StatelessWidget {
  const BakeryApp({super.key, required this.theme});

  final ThemeController theme;

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: theme,
      builder: (context, _) => MaterialApp(
        title: "Baker's Inn",
        debugShowCheckedModeBanner: false,
        theme: bakeryLight,
        darkTheme: bakeryDark,
        themeMode: theme.mode,
        home: Root(theme: theme),
      ),
    );
  }
}

/// Sign somebody in, or get on with the day.
class Root extends StatefulWidget {
  const Root({super.key, required this.theme});

  final ThemeController theme;

  @override
  State<Root> createState() => _RootState();
}

class _RootState extends State<Root> {
  late final AuthController _auth = AuthController();

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
        if (_auth.loading) {
          return const Scaffold(body: Center(child: LoadingNote(text: 'Starting up…')));
        }
        // No tablet-setup step. That screen asks which outlet a device is in and
        // which till it is — both meaningless on the owner's phone, which is not
        // at a counter and never rings anything up. The owner's own record says
        // where he belongs, and the security rules let him read every outlet.
        if (_auth.user == null) return LoginScreen(auth: _auth);
        return HomeScreen(auth: _auth, theme: widget.theme);
      },
    );
  }
}

/// The signed-in shell.
///
/// This app is the owner's. The tills, the kitchen and the close-of-day wizard
/// live in the browser app on the shop tablets, where they are used standing up
/// next to the thing being counted. Anyone else who signs in here is told so
/// plainly rather than shown a half-app.
class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key, required this.auth, required this.theme});

  final AuthController auth;
  final ThemeController theme;

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  int _tab = 0;

  static const _titles = ['Dashboard', 'Materials', 'Catalog'];

  @override
  Widget build(BuildContext context) {
    final auth = widget.auth;
    final theme = widget.theme;
    final profile = auth.profile;

    if (profile == null) {
      return _Message(
        title: 'This account has no staff record',
        detail: 'Ask the owner to add you, then sign in again.',
        onSignOut: auth.signOut,
      );
    }

    // There is no wrong-outlet check here, unlike the web app. That guard stops
    // a cashier stamping a sale with another shop's id — and nothing in this app
    // writes a sale, or writes anything at all.
    if (!profile.isOwner) {
      return _Message(
        title: 'This app is for the owner',
        detail:
            'The till, the kitchen list and the end-of-day count are in the '
            'browser app on the shop tablet — same system, same figures, and '
            'right next to the counter where they are used.',
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
            Text(_titles[_tab], style: context.type.titleMedium),
            // Just the name. The till letter that used to sit here is a counter
            // concept — this phone is not a till.
            Text(
              profile.name,
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
            // Kept alive across tabs: rebuilding the dashboard's nine listeners
            // every time he glances at a price would cost a round trip each way
            // and lose his scroll position.
            child: IndexedStack(
              index: _tab,
              children: [
                const DashboardScreen(),
                MaterialsScreen(user: (id: profile.uid, name: profile.name)),
                CatalogScreen(user: (id: profile.uid, name: profile.name)),
              ],
            ),
          ),
        ],
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _tab,
        onDestinationSelected: (i) => setState(() => _tab = i),
        destinations: const [
          NavigationDestination(
            icon: Icon(Icons.insights_outlined),
            selectedIcon: Icon(Icons.insights),
            label: 'Dashboard',
          ),
          NavigationDestination(
            icon: Icon(Icons.inventory_2_outlined),
            selectedIcon: Icon(Icons.inventory_2),
            label: 'Materials',
          ),
          NavigationDestination(
            icon: Icon(Icons.menu_book_outlined),
            selectedIcon: Icon(Icons.menu_book),
            label: 'Catalog',
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

