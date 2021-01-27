'use strict'

module.exports = {
  env: {
    browser: true,
    es6: true,
    node: true,
  },
  parser: '@typescript-eslint/parser',
  plugins: ['react', 'react-hooks', 'prettier', 'unused-imports'],
  extends: [
    'plugin:react/recommended',
    'eslint:recommended',
    'plugin:prettier/recommended',
    'plugin:@typescript-eslint/eslint-recommended',
    'plugin:@typescript-eslint/recommended',
  ],
  settings: {react: {version: 'detect'}},
  rules: {
    '@typescript-eslint/no-explicit-any': 0,
    '@typescript-eslint/no-empty-function': 0,
    '@typescript-eslint/no-unused-vars': 'off',

    'no-unused-vars': 'off',
    'unused-imports/no-unused-imports-ts': 1,

    'react/no-unescaped-entities': 0,
    'react/display-name': 0,

    'react-hooks/rules-of-hooks': 'error', // Checks rules of Hooks
    'react-hooks/exhaustive-deps': 'warn', // Checks effect dependencies
  },
}
