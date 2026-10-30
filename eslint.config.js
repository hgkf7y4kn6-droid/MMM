// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    // react-three-fiber elements take three.js props (args, metalness, ...) that the DOM rule doesn't know.
    files: ['components/hero-scene.tsx'],
    rules: { 'react/no-unknown-property': 'off' },
  },
  {
    ignores: ['dist/*', 'app-example/*', 'reference/*', 'backend/*'],
  },
]);
