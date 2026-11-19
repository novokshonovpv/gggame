import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  // Relative asset paths: the build works at any URL prefix (GitHub Pages serves it under /gggame/).
  base: "./",
  build: {
    // three.js is most of the bundle (~220 KB gzipped); one chunk is fine for a game.
    chunkSizeWarningLimit: 1000,
    // Two pages: the racing game and "Мото-город" (city.html), which can be embedded on its own.
    rolldownOptions: {
      input: {
        main: resolve(import.meta.dirname, "index.html"),
        city: resolve(import.meta.dirname, "city.html"),
      },
    },
  },
});
