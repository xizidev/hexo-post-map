import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/', 'node_modules/', '.superpowers/', 'playwright-report/', 'test-results/'],
  },
  ...tseslint.configs.recommended,
);
