import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import * as purgecssModule from "@fullhuman/postcss-purgecss";

// The plugin is CommonJS in some published versions and exposes a default
// export in others. Vite bundles this config before loading it, so a plain
// default import can become a namespace object and fail with
// "purgecss is not a function".
const purgecss = purgecssModule.default ?? purgecssModule;
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
export default defineConfig({
  root: here,
  publicDir: path.resolve(here, "public"),
  css: {
    /* The Bootstrap framework ships about ten thousand selectors; this page
       uses a few hundred. Measured before this was added: 240 KB of CSS, of
       which 163 KB (68%) could never match anything on the page.

       Purging at build time rather than editing the .scss keeps the source
       readable and keeps the saving automatic -- nobody has to remember.
       Run `node .bin/dead-css.mjs` to see the current numbers.

       The safelist covers what a static scan cannot see: classes Bootstrap's
       own JS attaches at runtime, and state classes toggled from our js/. */
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
    // NOT emptyOutDir. This outDir (frontend/dist) is the PARENT of the React
    // build's outDir (frontend/dist/react), so emptying it deleted the other
    // SPA — and the server used to start anyway, then answer /react/ with a
    // 500. Cleaning is the `clean` script's job, and `npm run build` runs it
    // once before both builds; a lone `npm run build:bootstrap` now leaves its
    // sibling alone (at the cost of stale hashed assets, which nothing links).
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