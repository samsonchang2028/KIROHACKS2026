// eslint.config.mjs — ESLint flat config for senior-assistant.
// Three environments: Node main process, Electron preload (Node + limited browser), browser renderer.
// Using .mjs so ESLint can load it as an ES module regardless of package.json "type".

import js from '@eslint/js';

export default [
  // Base recommended rules for all files
  {
    ...js.configs.recommended,
    rules: {
      ...js.configs.recommended.rules,

      // Code style — matches project conventions
      'no-var': 'error',
      'prefer-const': 'error',
      'no-unused-vars': ['error', {
        argsIgnorePattern: '^_',       // _e, _event, _blob etc. are intentional unused args
        caughtErrorsIgnorePattern: '^_', // _err in catch blocks is intentional
      }],
      'eqeqeq': ['error', 'always'],
      'curly': 'error',

      // Async — project uses async/await, not promise chains
      'no-promise-executor-return': 'error',
      'prefer-promise-reject-errors': 'error',

      // Safety
      'no-eval': 'error',
      'no-implied-eval': 'error',

      // Console — warn so they're visible before demo cleanup
      'no-console': 'warn',
    },
  },

  // Main process and preload — Node.js globals, CommonJS modules
  {
    files: ['main.js', 'preload.js', 'stubs.js'],
    languageOptions: {
      globals: {
        require: 'readonly',
        module: 'readonly',
        exports: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        process: 'readonly',
        console: 'readonly',
        setTimeout: 'readonly',
        Promise: 'readonly',
      },
    },
  },

  // Renderer and floating button — browser globals only, no Node
  {
    files: ['renderer.js', 'floating.js'],
    languageOptions: {
      globals: {
        window: 'readonly',
        document: 'readonly',
        console: 'readonly',
        setTimeout: 'readonly',
        Promise: 'readonly',
        Event: 'readonly',
        HTMLElement: 'readonly',
      },
    },
  },

  // Ignore generated files
  {
    ignores: ['node_modules/**'],
  },
];
