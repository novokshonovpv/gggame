import { defineConfig } from "vite";

export default defineConfig({
  // Relative asset paths: the build works at any URL prefix (GitHub Pages serves it under /gggame/).
  base: "./",
  // three.js is most of the bundle (~220 KB gzipped); one chunk is fine for a game.
  build: { chunkSizeWarningLimit: 1000 },
});
