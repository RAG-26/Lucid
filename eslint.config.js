import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  // eslint.config.js doesn't lint itself — a common convention, and it sidesteps
  // type-aware rules misfiring on `globals`' loosely-typed exports outside a real tsconfig.
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/data/**',
      '**/coverage/**',
      'eslint.config.js',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        // apps/web/vite.config.ts isn't included by apps/web/tsconfig.json (which only
        // covers src/**/*) — lint it without full cross-project type info instead of adding
        // config-file noise to that tsconfig.
        projectService: {
          allowDefaultProject: ['apps/web/vite.config.ts'],
        },
        tsconfigRootDir: import.meta.dirname,
      },
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
  },
  eslintConfigPrettier,
);
