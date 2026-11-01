























import {
  cropCanvasRgba,
  decodeImageRgba,
  openPdf,
  renderPageCanvas,
} from "../read/pdf-render.js";
import { binarise } from "../shape/raster.js";
import { matchRasterMask } from "../shape/match.js";

function grayFromRgba({ data, width, height }) {
  const gray = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i += 1) {
    const at = i * 4;

    const alpha = data[at + 3] / 255;
    const r = data[at] * alpha + 255 * (1 - alpha);
    const g = data[at + 1] * alpha + 255 * (1 - alpha);
    const b = data[at + 2] * alpha + 255 * (1 - alpha);
    gray[i] = Math.round(r * 0.299 + g * 0.587 + b * 0.114);
  }
  return { gray, width, height };
}


export function matchPixelsToVector({ data, width, height }, options = {}) {
  const { gray } = grayFromRgba({ data, width, height });
  return matchRasterMask(binarise(gray, width, height), width, height, options);
}






export async function matchImageToVector(imageBytes, options = {}) {
  return matchPixelsToVector(await decodeImageRgba(imageBytes), options);
}






export async function renderPdfRegionRgba(source, pageNumber, bbox, {
  scale = 4,
  pad = 4,
} = {}) {
  const doc = await openPdf(Buffer.isBuffer(source) ? source : Buffer.from(source));
  try {
    if (pageNumber < 1 || pageNumber > doc.numPages) throw new RangeError(`Invalid PDF page ${pageNumber}`);
    const page = await doc.getPage(pageNumber);
    try {
      const rendered = await renderPageCanvas(page, scale);
      return cropCanvasRgba(rendered.canvas, {
        x0: Math.min(bbox.x0, bbox.x1),
        y0: Math.min(bbox.y0, bbox.y1),
        x1: Math.max(bbox.x0, bbox.x1),
        y1: Math.max(bbox.y0, bbox.y1),
      }, { scale, pad });
    } finally {
      page.cleanup();
    }
  } finally {
    await doc.destroy();
  }
}

export async function matchPdfRegionToVector(source, pageNumber, bbox, options = {}) {
  const crop = await renderPdfRegionRgba(source, pageNumber, bbox, options);

  return { ...matchPixelsToVector(crop, options), crop: { width: crop.width, height: crop.height } };
}






export async function repairTextRegionWithVector(text, {
  start,
  end,
  image,
  candidates,
}, options = {}) {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end > text.length) {
    throw new RangeError("invalid vector-repair text range");
  }
  const match = await matchImageToVector(image, { ...options, candidates });
  if (!match.accepted) return { text, changed: false, match };
  return {
    text: `${text.slice(0, start)}${match.text}${text.slice(end)}`,
    changed: true,
    match,
  };
}
