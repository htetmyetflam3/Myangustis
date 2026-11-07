import js from '@eslint/js';
import prettier from 'eslint-config-prettier';

export default [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        console: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        window: 'readonly',
        document: 'readonly',
        navigator: 'readonly',
        FileReader: 'readonly',
        FormData: 'readonly',
        fetch: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        AbortController: 'readonly',
        AbortSignal: 'readonly',
        URL: 'readonly',
        Blob: 'readonly',
        ReadableStream: 'readonly',
        CompressionStream: 'readonly',
        Response: 'readonly',
        crypto: 'readonly',
        self: 'readonly',
        global: 'readonly',
        logger: 'readonly',
        Notyf: 'readonly',
        ProgressBar: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-console': 'off',
      'prefer-const': 'warn',
      eqeqeq: ['error', 'always'],
    },
  },
  {
    ignores: [
      'frontend/assets/js/*.js',
      'site/dev/js/pdf.worker.mjs',
      'site/dev/js/pdf.mjs',
      'site/dev/js/progressbar.js',
      'site/dev/js/notyf.js',
      'ENGINE/Part/Engine/_knowledge/mainrules.js',
      'ENGINE/Part/Engine/_knowledge/template.js',
      'jsconfig.js',
    ],
  },
  prettier,
];
