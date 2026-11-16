/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

/**
 * Library build: one ES module per entry in build/ (types come from tsc). The dev server keeps the
 * project root, so the examples stay at /examples/index.html and /examples/showcase.html.
 */
export default defineConfig({
  build: {
    outDir: 'build',
    emptyOutDir: true,
    sourcemap: true,
    lib: {
      // One file per public entry (see "exports" in package.json); shared code goes into chunks.
      entry: { index: 'src/index.ts', dev: 'src/dev.ts', noop: 'src/noop.ts' },
      formats: ['es'],
      fileName: (_format, name) => `${name}.js`
    },
    rolldownOptions: {
      external: [/^three(\/.*)?$/]
    }
  },
  test: {
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // Floors, a little under today's numbers: a drop fails `npm run test:coverage`.
      thresholds: { lines: 90, statements: 88, functions: 85, branches: 78 }
    }
  }
});
