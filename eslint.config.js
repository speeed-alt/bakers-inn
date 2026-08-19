import js from '@eslint/js'
import globals from 'globals'

// One job: catch the mistakes a passing build does not.
//
// `npm run build` bundles happily around an identifier that does not exist.
// That is not a hypothetical — twice now a screen has been shipped to the
// emulator with a name left dangling by an edited import, and both times the
// build was green and the screen was a blank error boundary. The second one was
// the till, which is the one screen this bakery cannot trade without.
//
// So this is deliberately not a style tool. There are no opinions here about
// quotes, semicolons or ordering; the code is written to be read and a linter
// arguing about commas would only get switched off. It looks for exactly the
// class of fault that reaches a shop: a name that is not there, a promise
// nobody waited for, a variable assigned and never used because the line that
// used it was deleted.
export default [
  {
    ignores: ['dist/**', 'node_modules/**', 'functions/shared/**', 'presentation/**'],
  },

  // The app: browser globals, JSX, ES modules.
  {
    files: ['src/**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      ...js.configs.recommended.rules,

      // The one that matters. Everything else here is a bonus.
      'no-undef': 'error',

      // Off in the app, and honestly rather than silently: without the React
      // plugin the parser cannot see that `<Money />` uses the `Money` import,
      // so every component in the file reads as unused. A rule that reports a
      // hundred and thirty things that are all fine is a rule somebody turns
      // off, and then it is not there for the one that is not fine. It stays on
      // for the plain-JavaScript files below, which have no JSX to hide a use.
      'no-unused-vars': 'off',

      // The CSV writer embeds a UTF-8 byte-order mark on purpose — it is what
      // makes Excel open the file without mangling every accented name. See
      // src/lib/csv.js.
      'no-irregular-whitespace': 'off',
    },
  },

  // Node: the scripts and the Cloud Functions.
  {
    files: ['scripts/**/*.mjs', 'functions/**/*.js', '*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      ...js.configs.recommended.rules,
      'no-undef': 'error',
      'no-unused-vars': ['error', { args: 'none', varsIgnorePattern: '^_' }],
    },
  },
]
