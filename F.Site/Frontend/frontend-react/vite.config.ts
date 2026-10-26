import path from "path";
import { fileURLToPath } from "url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// https://vite.dev/config/
export default defineConfig({
  base: "/react/",
  plugins: [
    react(),
    tailwindcss(),
    // `useRecommendedBuildConfig` (the default) forces `base: "./"`, which
    // makes the inlined CSS point at `url(./fonts/…)`. That resolves against
    // the DOCUMENT url, so the page only finds its webfonts when it is served
    // from `/react/` and silently loses them at `/react` — while the preload
    // links in index.html, which are absolute, fetch the right file anyway and
    // every face is downloaded twice. Keep `base` and apply the plugin's build
    // settings by hand instead.
    viteSingleFile({ useRecommendedBuildConfig: false }),
  ],
  build: {
    outDir: path.resolve(__dirname, "../dist/react"),
    emptyOutDir: true,
    // what useRecommendedBuildConfig would have set, minus the base rewrite
    assetsInlineLimit: 100_000_000,
    chunkSizeWarningLimit: 100_000_000,
    cssCodeSplit: false,
    reportCompressedSize: false,
    rollupOptions: { output: { inlineDynamicImports: true } },
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
