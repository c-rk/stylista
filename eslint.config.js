// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*'],
  },
  {
    // react-three-fiber maps JSX props onto three.js object properties.
    files: ['src/three/**/*.tsx'],
    rules: { 'react/no-unknown-property': 'off' },
  },
  {
    // Numeric kernels use comma-grouped accumulator updates.
    files: ['src/vision/**/*.ts', 'src/three/**/*.ts'],
    rules: { '@typescript-eslint/no-unused-expressions': 'off', 'no-unused-expressions': 'off' },
  },
]);
