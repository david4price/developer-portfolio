import eslint from '@eslint/js';
import nextPlugin from '@next/eslint-plugin-next';
import prettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/.test-dist/**',
      '**/.next/**',
      '**/out/**',
      '**/next-env.d.ts',
      'coverage/**',
      'node_modules/**',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-import-type-side-effects': 'error',
    },
  },
  {
    // Nest resolves constructor injection from emitted type metadata, so injected classes
    // must stay value imports.
    files: ['apps/api/src/**/*.ts', 'apps/worker/src/**/*.ts'],
    rules: {
      '@typescript-eslint/consistent-type-imports': 'off',
    },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    plugins: { '@next/next': nextPlugin },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,
    },
    settings: { next: { rootDir: 'apps/web' } },
  },
  {
    files: ['**/*.mjs', '**/*.js'],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        fetch: 'readonly',
        AbortSignal: 'readonly',
      },
    },
  },
  {
    // k6 scripts (P7-02) run in k6's JavaScript runtime, not Node.js.
    files: ['infrastructure/load-tests/**/*.js'],
    languageOptions: {
      globals: { __ENV: 'readonly', __VU: 'readonly', __ITER: 'readonly' },
    },
  },
  {
    files: ['infrastructure/load-tests/**/*.mjs'],
    languageOptions: { globals: { setTimeout: 'readonly' } },
  },
  prettier,
);
