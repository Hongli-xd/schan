import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/__tests__/**/*.test.ts'],
    transform: {
      '^.+\\.ts$': ['tsx', { tsconfig: './tsconfig.json' }]
    },
    exclude: ['node_modules', 'dist']
  }
});
