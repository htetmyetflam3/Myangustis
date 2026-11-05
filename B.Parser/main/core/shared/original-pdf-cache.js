import fs from "node:fs";
import { openPdfScannedObjects } from "./pdf-object-file.js";

// One shared original-PDF handle for a job.
//
// Parser prepares the PDF once and wraps that exact prepared file here;
// later stages (repair's line-SVG requests) ask this same handle instead of
// loading the PDF again. Page scenes and line SVGs are built lazily and
// retained on the handle for the life of the job: even whole-book line SVGs
// are small next to the parser's baseline, and sharing them is the point.
export function createOriginalPdfCache({
  sourcePdf = null,
  preparedPdf = null,
  pdf = null,
  directory = null,
  exportLineSvg: exportLineSvgImpl = null,
  exportPageSvg: exportPageSvgImpl = null,
} = {}) {
  let scannedHandle = null;
  let closed = false;
  const pageScenes = new Map();
  const lineSvgs = new Map();

  const notImplemented = (request = null) => {
    const error = new Error("JS PDF line SVG exporter is not implemented for this original-PDF cache yet");
    error.code = "PDF_LINE_SVG_NOT_IMPLEMENTED";
    if (request) error.request = request;
    return error;
  };

  const cache = {
    sourcePdf,
    preparedPdf: preparedPdf ?? pdf ?? sourcePdf,
    pdf: preparedPdf ?? pdf ?? sourcePdf,
    directory,

    // The prepared PDF is scanned at most once per handle; every later stage
    // reuses the same object index instead of opening the file again.
    scannedObjects() {
      if (closed) throw new Error("original-PDF cache is closed");
      if (!cache.pdf) throw new TypeError("original-PDF cache has no PDF to scan");
      scannedHandle ??= openPdfScannedObjects(cache.pdf);
      return scannedHandle.objects;
    },

    // One page scene per page, built on first ask and kept for reuse.
    async pageScene(page, buildPageScene = null) {
      if (closed) throw new Error("original-PDF cache is closed");
      const key = String(page);
      if (pageScenes.has(key)) return pageScenes.get(key);
      const builder = buildPageScene ?? exportPageSvgImpl;
      if (typeof builder !== "function") throw notImplemented({ page });
      const scene = await builder({
        cache, page, sourcePdf: cache.sourcePdf, preparedPdf: cache.preparedPdf, pdf: cache.pdf,
      });
      pageScenes.set(key, scene);
      return scene;
    },

    // Repair contract: one broken line in, that line's SVG response out.
    async exportLineSvg(request = {}) {
      if (closed) throw new Error("original-PDF cache is closed");
      const key = String(request.id ?? `${request.page ?? "unknown"}:${request.line ?? "unknown"}`);
      if (lineSvgs.has(key)) return lineSvgs.get(key);
      let response;
      if (typeof exportLineSvgImpl === "function") {
        response = await exportLineSvgImpl({
          ...request,
          cache,
          sourcePdf: cache.sourcePdf,
          preparedPdf: cache.preparedPdf,
          pdf: cache.pdf,
        });
      } else if (typeof exportPageSvgImpl === "function") {
        const scene = await cache.pageScene(request.page);
        response = scene?.lines?.get?.(request.line)
          ?? scene?.lines?.[request.line]
          ?? scene?.lineSvgs?.get?.(key)
          ?? scene?.lineSvgs?.[key]
          ?? null;
        if (typeof response === "string") {
          response = { id: key, page: request.page, line: request.line, svg: response };
        }
        if (!response) throw notImplemented(request);
      } else {
        throw notImplemented(request);
      }
      lineSvgs.set(key, response);
      return response;
    },

    stats() {
      const sizeOf = (value) => {
        try {
          return typeof value === "string" && fs.existsSync(value) ? fs.statSync(value).size : null;
        } catch {
          return null;
        }
      };
      return {
        sourcePdf: cache.sourcePdf,
        preparedPdf: cache.preparedPdf,
        sourceBytes: sizeOf(cache.sourcePdf),
        preparedBytes: sizeOf(cache.preparedPdf),
        scanned: scannedHandle !== null,
        pageScenes: pageScenes.size,
        lineSvgs: lineSvgs.size,
        closed,
      };
    },

    close() {
      if (closed) return;
      closed = true;
      scannedHandle?.close();
      scannedHandle = null;
      pageScenes.clear();
      lineSvgs.clear();
    },
  };

  return cache;
}
