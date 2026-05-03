import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    // Per-file env override: .tsx tests opt into jsdom via a docblock comment
    // at the top of the file (`// @vitest-environment jsdom`). vitest 4.x
    // removed environmentMatchGlobs; the docblock is the supported approach.
    setupFiles: ['./src/test/setup.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/.next/**', '**/.claude/worktrees/**'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
