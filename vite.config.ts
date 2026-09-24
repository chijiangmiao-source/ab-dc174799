import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    outDir: 'dist',
    sourcemap: true
  },
  worker: {
    format: 'es'
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts']
  }
});
