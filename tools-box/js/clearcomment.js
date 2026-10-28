#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as espree from 'espree';

const OPTIONS = { ecmaVersion: 'latest', sourceType: 'module', comment: true, range: true, loc: true, ecmaFeatures: { jsx: true } };
const EXCLUDED = /(?:^|\/)[^/]*(?:logen|lexical_no_inspect|lexic_no_inspect)[^/]*(?:\/|$)/i;

function keepComment(comment) {
  if (comment.type === 'Hashbang') return true;
  const text = comment.value.replace(/^\s*\*\s?/gm, '').trim();
  return /^(?:eslint(?:[-\s]|$)|globals?\b|exported\b)/i.test(text)
    || /(?:@vite-|webpack(?:ChunkName|Mode|Prefetch|Preload|Ignore|Exports)|\b(?:istanbul|c8) ignore\b|\bfalls?\s?through\b|[@#]__PURE__|@ts-(?:check|nocheck|ignore|expect-error)|@license\b|@preserve\b|^!|[#@]\s*source(?:Mapping)?URL=)/i.test(text);
}

export function tidyTrailingWhitespace(code) {
  const parsed = espree.tokenize(code, OPTIONS);
  const occupied = [...parsed, ...parsed.comments].map(({ range }) => range).sort((a, b) => a[0] - b[0]);
  const pieces = [];
  let cursor = 0;
  let interval = 0;
  for (const match of code.matchAll(/[\t ]+(?=\r?$)/gm)) {
    const start = match.index;
    const end = start + match[0].length;
    while (interval < occupied.length && occupied[interval][1] <= start) interval += 1;
    if (interval < occupied.length && occupied[interval][0] < end) continue;
    pieces.push(code.slice(cursor, start));
    cursor = end;
  }
  pieces.push(code.slice(cursor));
  let result = pieces.join('');
  const interim = espree.tokenize(result, OPTIONS);
  const lastEnd = Math.max(0, ...[...interim, ...interim.comments].map(({ range }) => range[1]));
  const trailingLines = result.match(/(?:\r\n|\n|\r){2,}$/);
  if (trailingLines && trailingLines.index >= lastEnd) {
    const newline = trailingLines[0].match(/^(?:\r\n|\n|\r)/)[0];
    result = result.slice(0, trailingLines.index) + newline;
  }
  const after = espree.tokenize(result, OPTIONS);
  const signature = (items) => items.map(({ type, value, loc }) => [type, value, loc]);
  if (JSON.stringify(signature(parsed)) !== JSON.stringify(signature(after)) ||
      JSON.stringify(signature(parsed.comments)) !== JSON.stringify(signature(after.comments))) {
    throw new Error('Refusing to change JavaScript tokens, directives, or line positions');
  }
  return result;
}

export function stripComments(code) {
  const original = espree.tokenize(code, OPTIONS);
  const emptyBlocks = [];
  for (let i = 0; i + 1 < original.length; i += 1) {
    if (original[i].value === '{' && original[i + 1].value === '}') {
      emptyBlocks.push([original[i].range[1], original[i + 1].range[0]]);
    }
  }
  let cleaned = '';
  let at = 0;
  for (const comment of original.comments) {
    const [start, end] = comment.range;
    cleaned += code.slice(at, start);
    const text = code.slice(start, end);
    const explainsEmptyBlock = emptyBlocks.some(([left, right]) => start >= left && end <= right);
    cleaned += keepComment(comment) || explainsEmptyBlock ? text : text.replace(/[^\r\n\u2028\u2029]/g, ' ');
    at = end;
  }
  cleaned += code.slice(at);
  const after = espree.tokenize(cleaned, OPTIONS);
  const signature = (tokens) => tokens.map(({ type, value, range }) => [type, value, range]);
  if (JSON.stringify(signature(original)) !== JSON.stringify(signature(after))) {
    throw new Error('Refusing to change JavaScript tokens or offsets');
  }
  return cleaned === code ? code : tidyTrailingWhitespace(cleaned);
}

function main(args) {
  const dryRun = args.includes('--dry-run');
  const targets = args.filter((arg) => arg !== '--dry-run');
  if (targets.length !== 1) throw new Error('Usage: node clearcomment.js [--dry-run] <file-or-directory>');
  const target = path.resolve(targets[0]);
  const stat = fs.statSync(target);
  const repo = execFileSync('git', ['-C', stat.isDirectory() ? target : path.dirname(target), 'rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  const names = execFileSync('git', ['-C', repo, 'ls-files', '--cached', '--others', '--exclude-standard', '-z'], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }).split('\0');
  const files = [...new Set(names)].filter((name) => {
    if (!name.endsWith('.js') || EXCLUDED.test(name)) return false;
    const full = path.resolve(repo, name);
    if (stat.isDirectory() ? full !== target && !full.startsWith(target + path.sep) : full !== target) return false;
    try { return fs.lstatSync(full).isFile(); } catch { return false; }
  }).sort();
  const changes = [];
  for (const name of files) {
    const full = path.join(repo, name);
    const code = fs.readFileSync(full, 'utf8');
    try {
      const cleaned = stripComments(code);
      if (cleaned !== code) changes.push({ name, full, cleaned });
    } catch (error) {
      throw new Error(`${name}: ${error.message}`, { cause: error });
    }
  }
  if (!dryRun) for (const item of changes) fs.writeFileSync(item.full, item.cleaned, 'utf8');
  console.log(`${dryRun ? 'Would clean' : 'Cleaned'} ${changes.length} of ${files.length} JavaScript files; ESLint and other tool directives are retained.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
