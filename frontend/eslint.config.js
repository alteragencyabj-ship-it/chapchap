// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*'],
    rules: {
      // This rule is aimed at React DOM/HTML; it creates noise in React Native <Text>.
      'react/no-unescaped-entities': 'off',
    },
  },
]);
