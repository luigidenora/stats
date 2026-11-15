import { defineConfig } from 'vite';

/** Static build of the demo and the showcase, for hosting. */
export default defineConfig({
  base: './',
  build: {
    outDir: 'site',
    emptyOutDir: true,
    // three.js itself is most of the demo bundle.
    chunkSizeWarningLimit: 1500,
    rolldownOptions: {
      input: {
        demo: 'examples/index.html',
        showcase: 'examples/showcase.html'
      }
    }
  }
});
