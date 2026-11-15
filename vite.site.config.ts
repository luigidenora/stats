import { defineConfig } from 'vite';

/**
 * Static build of the demo and the showcase, for hosting. The examples folder is the site root,
 * so the demo is served at / and the showcase at /showcase.html.
 */
export default defineConfig({
  root: 'examples',
  base: './',
  build: {
    outDir: '../site',
    emptyOutDir: true,
    // three.js itself is most of the demo bundle.
    chunkSizeWarningLimit: 1500,
    rolldownOptions: {
      input: {
        index: 'examples/index.html',
        showcase: 'examples/showcase.html'
      }
    }
  }
});
