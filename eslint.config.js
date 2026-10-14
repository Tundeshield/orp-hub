import globals from 'globals';
import react from 'eslint-plugin-react';
import hooks from 'eslint-plugin-react-hooks';

export default [
  { ignores: ['dist', 'node_modules'] },
  {
    files: ['**/*.{js,jsx,mjs}'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'module', globals: { ...globals.browser, ...globals.node }, parserOptions: { ecmaFeatures: { jsx: true } } },
    plugins: { react, 'react-hooks': hooks },
    settings: { react: { version: '18' } },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': ['warn', { varsIgnorePattern: '^_' }],
      'react/jsx-uses-vars': 'error',
      'react/jsx-uses-react': 'error',
      'react/jsx-key': 'error',
      'react/jsx-no-undef': 'error',
      'react-hooks/rules-of-hooks': 'error',
    },
  },
];
