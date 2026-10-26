import path from "path";
import { fileURLToPath } from "url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// https://vite.dev/config/
export default defineConfig({
  base: "/react/",
  plugins: [react(), tailwindcss()],
  build: {
    outDir: path.resolve(__dirname, "../dist/react"),
    emptyOutDir: true,

    /*
     * This client used to ship through `vite-plugin-singlefile`: every chunk,
     * the stylesheet and pdf.js were inlined into one 3.0 MB index.html.
     * Nothing requires that — the backend serves `frontend/dist` as a static
     * directory (`FRONTEND_DIR` in backend/file/paths.js), exactly as it
     * serves the Bootstrap client, which has always shipped split assets.
     *
     * What the single file cost, and what the Bootstrap client never paid:
     *   - no caching. The markup and the whole runtime share one URL, so a
     *     repeat visit re-downloads all 3 MB instead of revalidating a few
     *     hashed files.
     *   - no parallelism and no streaming. The browser cannot start fetching
     *     the app while it parses the document, because the app *is* the
     *     document, and a multi-megabyte inline <script> blocks the parser.
     *   - no code splitting. `inlineDynamicImports` folded the lazy routes in
     *     too, so pdf.js (~0.5 MB, plus a 1.3 MB worker) landed in the first
     *     paint of a visitor who never opens a PDF.
     *
     * So it is a normal split build now: hashed, cacheable assets and real
     * dynamic imports. The base stays `/react/` (absolute) rather than the
     * `./` the plugin used to force — relative URLs resolved against the
     * document, so the webfonts were found at `/react/` and silently lost at
     * `/react`.
     */
    reportCompressedSize: false,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
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
