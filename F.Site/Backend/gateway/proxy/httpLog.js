import morgan from 'morgan';
import { palette as C, moduleBadges, statusColors, stamp, paint } from '../../../../Bridge/logen/site.js';
const useColor = !process.env.NO_COLOR;
function levelFor(status) {
  if (status >= 500) return 'error';
  if (status >= 400) return 'warn';
  if (status >= 300) return 'info';
  if (status >= 200) return 'success';
  return 'processing';
}
const METHOD_COLOR = {
  GET: C.method,
  POST: C.string,
  PUT: C.warn,
  PATCH: C.warn,
  DELETE: C.err,
  OPTIONS: C.comment,
  HEAD: C.comment,
};
function humanSize(bytes) {
  if (bytes === undefined || bytes === null || Number.isNaN(bytes)) return '-';
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
export function createHttpConsoleLogger() {
  return morgan((tokens, req, res) => {
    const status = Number(tokens.status(req, res)) || 0;
    const level = levelFor(status);
    const clr = statusColors[level] || C.info;
    const badge = moduleBadges.HTTP || moduleBadges.SYSTEM;
    const badgeStr = useColor
      ? `${badge.code} ${badge.label.padEnd(6)} ${C.rst}`
      : `[${badge.label}]`;
    const method = tokens.method(req, res) || '-';
    const url = tokens.url(req, res) || '-';
    const ms = Number(tokens['response-time'](req, res));
    const len = Number(tokens.res(req, res, 'content-length'));
    const timeColor = ms >= 1000 ? C.err : ms >= 250 ? C.warn : C.num;
    const bar = paint(C.op, '|');
    return [
      paint(C.comment, stamp()),
      badgeStr,
      paint(`${clr}${C.bold}`, level.toUpperCase().padEnd(7)),
      paint(METHOD_COLOR[method] || C.var, method),
      paint(C.string, url),
      bar,
      paint(clr, status || '---'),
      bar,
      paint(timeColor, Number.isFinite(ms) ? `${ms.toFixed(1)}ms` : '-'),
      bar,
      paint(C.comment, humanSize(len)),
    ].join(' ');
  });
}

export function createHttpFileLogger(stream) {
  return morgan('combined', { stream });
}