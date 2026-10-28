import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import * as purgecssModule from "@fullhuman/postcss-purgecss";





const purgecss = purgecssModule.default ?? purgecssModule;
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
export default defineConfig({
  root: here,
  publicDir: path.resolve(here, "public"),
  css: {










    postcss: {
      plugins: [
        purgecss({
          content: [
            path.join(here, "index.html"),
            path.join(here, "js/**/*.js"),
          ],
          safelist: {
            standard: [/^is-/, /^has-/, /^js-/, "active", "show", "fade", "collapsing", "disabled"],
            deep: [/^modal/, /^offcanvas/, /^collaps/, /^dropdown/, /^tooltip/, /^popover/, /^carousel/, /^bs-/],
            greedy: [/^fx-/, /^lp-/, /^ak-/, /^gr-/],
          },
        }),
      ],
    },
    preprocessorOptions: {
      scss: {
        quietDeps: true,
        silenceDeprecations: ["import", "global-builtin", "color-functions"],
      },
    },
  },
  build: {
    outDir: path.resolve(root, "dist"),






    emptyOutDir: false,
  },
  server: {
    host: "0.0.0.0",
    allowedHosts: true,
  },
  preview: {
    host: "0.0.0.0",
    allowedHosts: true,
  },
});