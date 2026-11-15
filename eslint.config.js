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
]);
