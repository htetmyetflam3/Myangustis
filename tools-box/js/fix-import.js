#!/usr/bin/env node





































import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import readline from 'readline';

const __filename = path.resolve(fileURLToPath(import.meta.url));


const SELF_MARKER = 'self-scan-exclusion: 7f3a91c0';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = q => new Promise(res => rl.question(q, a => res(a.trim())));

let filesScanned = 0;
let filesModified = 0;
let importsFixed = 0;
let importsVerified = 0;
let importsBroken = 0;









const argv = process.argv.slice(2);
const UNUSED_MODE = argv.includes('--unused');
const positionals = argv.filter(a => !a.startsWith('--'));
const START_DIR = path.resolve(positionals[0] || '.');


const CLIMB_CEILING = UNUSED_MODE ? START_DIR
  : (positionals[1] ? path.resolve(START_DIR, positionals[1]) : null);
const ROOT_MARKERS = ['package.json', '.git', 'node_modules'];
const MAX_ROOT_CLIMB = 6;

function isWithin(filePath, dir) {
  const rel = path.relative(dir, filePath);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

if (CLIMB_CEILING && !isWithin(START_DIR, CLIMB_CEILING)) {
  console.error(`Climb ceiling ${CLIMB_CEILING} is not an ancestor of start dir ${START_DIR}.`);
  console.error('The ceiling must be the start dir or one of its ancestors; refusing to run.');
  process.exit(2);
}

function findProjectRoot(startDir) {
  let dir = startDir;
  for (let i = 0; i < MAX_ROOT_CLIMB; i++) {
    if (ROOT_MARKERS.some(m => fs.existsSync(path.join(dir, m)))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;

    if (CLIMB_CEILING && !isWithin(parent, CLIMB_CEILING)) break;
    dir = parent;
  }
  return startDir;
}


const PROJECT_ROOT = UNUSED_MODE ? START_DIR : findProjectRoot(START_DIR);




const fileExports = new Map();
const exportMap   = new Map();
const basenameMap = new Map();
const indexed     = new Set();
const selfFiles   = new Set();

function addExport(filePath, name) {
  if (!fileExports.has(filePath)) fileExports.set(filePath, new Set());
  fileExports.get(filePath).add(name);
  if (!exportMap.has(name)) exportMap.set(name, new Set());
  exportMap.get(name).add(filePath);
}


function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

function indexExports(filePath, content) {
  const src = stripComments(content);








  const declRe = /export\s+(?:async\s+)?(?:function\s*\*\s*|function\s+|class\s+)([A-Za-z_$][\w$]*)/g;
  const varRe = /export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g;


  const listRe = /export\s*\{([^}]+)\}(?!\s*as\b)/g;
  const renamedBraceRe = /export\s*\{[^}]*\}\s*as\s+([A-Za-z_$][\w$]*)\b/g;
  const starRe = /export\s+\*\s+from\s+['"][^'"]+['"]/g;
  const nsRe = /export\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s+['"][^'"]+['"]/g;





  let m;
  while ((m = declRe.exec(src)) !== null) addExport(filePath, m[1]);
  while ((m = varRe.exec(src)) !== null) addExport(filePath, m[1]);
  while ((m = renamedBraceRe.exec(src)) !== null) addExport(filePath, m[1]);
  while ((m = listRe.exec(src)) !== null) {
    m[1].split(',').forEach(part => {
      const segs = part.trim().split(/\s+as\s+/);
      const name = segs[segs.length - 1].trim();
      if (name && /^[A-Za-z_$][\w$]*$/.test(name)) addExport(filePath, name);
    });
  }

  while ((m = starRe.exec(src)) !== null) addExport(filePath, '*');
  while ((m = nsRe.exec(src)) !== null) addExport(filePath, m[1]);
  if (/export\s+default\b/.test(src)) addExport(filePath, 'default');
}

function ensureIndexed(filePath) {
  if (indexed.has(filePath)) return;
  let st;
  try { st = fs.statSync(filePath); } catch { return; }
  if (!st.isFile()) return;
  let content;
  try { content = fs.readFileSync(filePath, 'utf-8'); } catch { return; }
  indexed.add(filePath);
  if (filePath === __filename || content.includes(SELF_MARKER)) {
    selfFiles.add(filePath);
    return;
  }
  indexExports(filePath, content);
  const bn = path.basename(filePath);
  if (!basenameMap.has(bn)) basenameMap.set(bn, new Set());
  basenameMap.get(bn).add(filePath);
}

function isDotFile(name) { return name.startsWith('.'); }



function shouldSkipDir(name) {
  return name === 'node_modules' || name === '.git' || name === 'dist' || isDotFile(name);
}

function scanTree(dir, skipDirs = new Set()) {
  const out = [];
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (isDotFile(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (shouldSkipDir(e.name) || skipDirs.has(full)) continue;
      out.push(...scanTree(full, skipDirs));
    } else if (e.isFile() && /\.(js|mjs)$/.test(e.name)) {
      out.push(full);
    }
  }
  return out;
}

const allFiles = scanTree(PROJECT_ROOT);
for (const f of allFiles) ensureIndexed(f);
const realCount = allFiles.length - selfFiles.size;

console.log(`Start dir:    ${START_DIR}`);
console.log(`Project root: ${PROJECT_ROOT}`);
if (CLIMB_CEILING) console.log(`Climb ceiling: ${CLIMB_CEILING} (upward walk stops here)`);
console.log(`Indexed ${realCount} .js/.mjs files (skipped ${selfFiles.size} copy/copies of this script).`);
console.log(`Indexed exports from ${realCount} files.\n`);




const IMPORT_RE = /import\s+(?:type\s+)?(?:(?:\{[^}]*\}|[A-Za-z_$][\w$]*(?:\s*,\s*\{[^}]*\})?|\*\s+as\s+\w+)\s+from\s+)?['"]([^'"]+)['"]|import\s*\(['"]([^'"]+)['"]\)/g;





const DYNAMIC_DESTRUCTURED_RE = /(?:const|let|var)\s*\{([^}]+)\}\s*=\s*await\s*import\(\s*['"]([^'"]+)['"]\s*\)/g;





const PROMISE_ALL_RE = /(?:const|let|var)\s*(\[[\s\S]*?\])\s*=\s*await\s*Promise\.all\(\s*\[([\s\S]*?)\]\s*\)/g;

function braceRemoteNames(group) {
  return group.split(',').map(part => part.trim().split(':')[0].trim())
    .filter(name => /^[A-Za-z_$][\w$]*$/.test(name));
}

function parseImports(content) {
  const out = [];
  let m;
  IMPORT_RE.lastIndex = 0;
  while ((m = IMPORT_RE.exec(content)) !== null) {
    const p = m[1] || m[2];
    const full = m[0];
    const pIdx = m.index + full.indexOf(p);
    out.push({ path: p, pIdx, pEnd: pIdx + p.length, ...extractImportInfo(full, p) });
  }
  DYNAMIC_DESTRUCTURED_RE.lastIndex = 0;
  while ((m = DYNAMIC_DESTRUCTURED_RE.exec(content)) !== null) {
    const p = m[2];
    const full = m[0];
    const pIdx = m.index + full.indexOf(p);


    const names = braceRemoteNames(m[1]);
    out.push({ path: p, pIdx, pEnd: pIdx + p.length, names, defaultBinding: null, isStar: false });
  }
  PROMISE_ALL_RE.lastIndex = 0;
  while ((m = PROMISE_ALL_RE.exec(content)) !== null) {
    const full = m[0];
    const groups = [...m[1].matchAll(/\{([^{}]*)\}/g)].map(g => g[1]);
    const paths = [...m[2].matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g)].map(g => g[1]);


    const strictLhs = /^\s*\[\s*(?:\{[^{}]*\}\s*,\s*)*\{[^{}]*\}\s*\]\s*$/.test(m[1]);
    const strictRhs = m[2].replace(/import\(\s*['"][^'"]+['"]\s*\)/g, '').replace(/[\s,]/g, '') === '';
    if (!strictLhs || !strictRhs || groups.length !== paths.length || groups.length === 0) continue;
    paths.forEach((p, i) => {
      const pIdx = m.index + full.indexOf(p);
      out.push({
        path: p, pIdx, pEnd: pIdx + p.length,
        names: braceRemoteNames(groups[i]), defaultBinding: null, isStar: false,
      });
    });
  }


  const bySpan = new Map();
  for (const record of out) {
    const key = `${record.pIdx}:${record.pEnd}`;
    const prev = bySpan.get(key);
    if (!prev || (!prev.names.length && record.names.length)) bySpan.set(key, record);
  }
  return [...bySpan.values()];
}

function extractImportInfo(fullImport, importPath) {
  const names = [];
  let defaultBinding = null;
  let isStar = false;




  const beforePath = fullImport.slice(0, fullImport.indexOf(importPath));
  let stmt = beforePath.replace(/^import\s*/, '').replace(/\s+from\s*['"]?$/, '').trim();

  if (!stmt || stmt === "'" || stmt === '"') return { names, defaultBinding, isStar };
  if (stmt.startsWith('type ')) stmt = stmt.slice(5).trim();

  if (stmt.startsWith('*')) {

    return { names, defaultBinding, isStar: true };
  }

  const comboMatch = stmt.match(/^([A-Za-z_$][\w$]*)\s*,\s*(.*)$/);
  if (comboMatch) {
    defaultBinding = comboMatch[1];
    names.push('default');
    stmt = comboMatch[2].trim();
  }

  if (stmt.startsWith('{')) {
    const braceMatch = stmt.match(/\{([^}]*)\}/);
    if (braceMatch) {
      for (const part of braceMatch[1].split(',')) {
        const segs = part.trim().split(/\s+as\s+/);




        const remote = segs[0].trim();
        if (remote && /^[A-Za-z_$][\w$]*$/.test(remote)) names.push(remote);
      }
    }
  } else if (!comboMatch) {
    const dm = stmt.match(/^([A-Za-z_$][\w$]*)$/);
    if (dm) { defaultBinding = dm[1]; names.push('default'); }
  }

  return { names, defaultBinding, isStar };
}




function isBareModule(p) { return !p.startsWith('.') && !path.isAbsolute(p); }

function relPath(fromFile, toFile) {
  const r = path.relative(path.dirname(fromFile), toFile).replace(/\\/g, '/');
  return r.startsWith('.') ? r : './' + r;
}

function resolveImportPath(fromFile, importPath) {
  if (isBareModule(importPath)) return null;
  const base = importPath.startsWith('.')
    ? path.resolve(path.dirname(fromFile), importPath)
    : path.resolve(importPath);

  const tries = [];
  if (path.extname(base)) {
    tries.push(base);
    if (base.endsWith('.js')) tries.push(base.slice(0, -3) + '.mjs');
    else if (base.endsWith('.mjs')) tries.push(base.slice(0, -4) + '.js');
  } else {
    tries.push(base + '.js', base + '.mjs',
               path.join(base, 'index.js'), path.join(base, 'index.mjs'));
  }
  for (const t of tries) {
    try { if (fs.statSync(t).isFile()) return t; } catch {}
  }
  return null;
}

function fileProvidesAll(filePath, names) {
  if (!names || names.length === 0) return true;
  const pExports = fileExports.get(filePath);
  if (!pExports) return false;
  if (pExports.has('*')) return true;
  return names.every(n => pExports.has(n));
}

function findFilesByExports(names) {
  if (!names || names.length === 0) return [];
  let candidates = null;
  for (const name of names) {
    const files = exportMap.get(name);
    if (!files) return [];
    if (candidates === null) candidates = new Set(files);
    else for (const f of [...candidates]) if (!files.has(f)) candidates.delete(f);
    if (candidates.size === 0) return [];
  }
  for (const f of [...candidates]) if (selfFiles.has(f)) candidates.delete(f);
  return [...candidates];
}

function basenameCandidates(importPath) {
  const bn = path.basename(importPath);
  const wanted = path.extname(bn) ? [bn] : [bn + '.js', bn + '.mjs'];
  const out = new Set();
  for (const w of wanted) {
    const s = basenameMap.get(w);
    if (s) for (const f of s) if (!selfFiles.has(f)) out.add(f);
  }
  return [...out];
}

function findCandidates(imp) {
  let cands = findFilesByExports(imp.names);
  if (cands.length === 0 && imp.names.length > 0) {
    const wild = [...(exportMap.get('*') || [])].filter(f => !selfFiles.has(f));
    if (wild.length) return wild;
  }
  if (cands.length === 0) cands = basenameCandidates(imp.path);
  return cands;
}





const MAX_SEARCH_CLIMB = 6;
let climbed = false;

function findCandidatesWithClimb(imp) {
  let cands = findCandidates(imp);
  if (cands.length > 0 || climbed) return cands;
  let dir = path.dirname(PROJECT_ROOT);
  for (let level = 0; level < MAX_SEARCH_CLIMB && dir !== path.dirname(dir); level++) {

    if (CLIMB_CEILING && !isWithin(dir, CLIMB_CEILING)) break;
    for (const f of scanTree(dir, new Set([PROJECT_ROOT]))) ensureIndexed(f);
    cands = findCandidates(imp);
    if (cands.length > 0) break;

    if (CLIMB_CEILING && path.resolve(dir) === path.resolve(CLIMB_CEILING)) break;
    dir = path.dirname(dir);
  }
  climbed = true;


  if (CLIMB_CEILING) cands = cands.filter(c => isWithin(c, CLIMB_CEILING));
  return cands;
}

function scoreDefaultMatch(filePath, defaultBinding) {
  let score = 0;
  const basename = path.basename(filePath).replace(/\.(m?js)$/, '').toLowerCase();
  const bindingLower = defaultBinding ? defaultBinding.toLowerCase() : '';
  if (bindingLower && basename === bindingLower) score += 30;
  else if (bindingLower && basename.includes(bindingLower)) score += 10;
  else if (bindingLower && bindingLower.includes(basename)) score += 5;
  const pExports = fileExports.get(filePath);
  if (pExports && defaultBinding && pExports.has(defaultBinding)) score += 15;
  return score;
}




async function fixFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const imports = parseImports(content);
  if (!imports.length) return;
  filesScanned++;

  let newContent = content;
  let offset = 0;
  let changed = false;

  for (const imp of imports) {
    const raw = imp.path;
    if (isBareModule(raw)) continue;

    const actualPath = resolveImportPath(filePath, raw);

    if (actualPath) {
      ensureIndexed(actualPath);
      if (fileProvidesAll(actualPath, imp.names)) {
        importsVerified++;
        continue;
      }
      importsBroken++;
      console.log(`\n  [BROKEN] ${path.relative(PROJECT_ROOT, filePath)}`);
      console.log(`    Import: ${raw}`);
      console.log(`    File exists at: ${path.relative(PROJECT_ROOT, actualPath)}`);
      console.log(`    But it does NOT export: {${imp.names.join(', ')}}`);
    } else {
      importsBroken++;
      console.log(`\n  [MISSING] ${path.relative(PROJECT_ROOT, filePath)}`);
      console.log(`    Import: ${raw}`);
      console.log(`    File does NOT exist at this path`);
    }

    let candidates = findCandidatesWithClimb(imp);
    candidates = candidates.filter(c => c !== actualPath);

    if (candidates.length > 1 && imp.defaultBinding) {
      const scored = candidates
        .map(p => ({ path: p, score: scoreDefaultMatch(p, imp.defaultBinding) }))
        .sort((a, b) => b.score - a.score);
      if (scored[0].score > 0 && scored[0].score > (scored[1]?.score || 0)) {
        candidates = [scored[0].path];
      }
    }

    if (candidates.length === 0) {
      console.log(`    [SKIP] No matching file found${climbed ? ' (searched upward too)' : ''}${imp.names.length ? ` for exports: {${imp.names.join(', ')}}` : ''}`);
      continue;
    }

    if (candidates.length > 1) {
      console.log(`    [SKIP] Multiple candidate files${imp.names.length ? ` exporting {${imp.names.join(', ')}}` : ''}:`);
      for (const c of candidates) {
        console.log(`      - ${path.relative(PROJECT_ROOT, c)}`);
      }
      continue;
    }

    const correctFile = candidates[0];
    const correctPath = relPath(filePath, correctFile);

    console.log(`    Found correct file: ${path.relative(PROJECT_ROOT, correctFile)}`);
    console.log(`    Suggested fix: ${raw} -> ${correctPath}`);

    const answer = await ask(`    Apply fix? [Y/N]: `);
    if (answer.toLowerCase() === 'y') {
      const s = imp.pIdx + offset;
      const e = imp.pEnd + offset;
      newContent = newContent.slice(0, s) + correctPath + newContent.slice(e);
      offset += correctPath.length - raw.length;
      importsFixed++;
      changed = true;
      console.log(`    [FIXED]`);
    } else {
      console.log(`    [SKIPPED]`);
    }
  }

  if (changed) {
    fs.writeFileSync(filePath, newContent, 'utf-8');
    filesModified++;
  }
}






function reportUnusedExports() {



  const usedByFile = new Map();
  const usedNamesGlobal = new Set();
  const starImportedFiles = new Set();

  for (const file of allFiles) {
    if (selfFiles.has(file)) continue;
    const content = fs.readFileSync(file, 'utf-8');
    for (const imp of parseImports(content)) {
      if (imp.isStar) {
        const target = resolveImportPath(file, imp.path);
        if (target) starImportedFiles.add(target);
        continue;
      }
      if (!imp.names.length) continue;
      const target = resolveImportPath(file, imp.path);
      if (target) {
        if (!usedByFile.has(target)) usedByFile.set(target, new Set());
        for (const n of imp.names) usedByFile.get(target).add(n);
      } else {
        for (const n of imp.names) usedNamesGlobal.add(n);
      }
    }
  }

  const report = [];
  let totalUnused = 0;
  for (const [file, names] of fileExports) {
    if (selfFiles.has(file) || starImportedFiles.has(file)) continue;
    const usedHere = usedByFile.get(file);
    const unused = [...names]
      .filter(n => n !== '*' && !usedNamesGlobal.has(n) && !(usedHere && usedHere.has(n)))
      .sort();
    if (unused.length) {
      report.push({ file: path.relative(PROJECT_ROOT, file), unusedExports: unused });
      totalUnused += unused.length;
    }
  }
  report.sort((a, b) => a.file.localeCompare(b.file));

  console.log('='.repeat(50));
  console.log(`Unused-export scan (down only, no climb): ${PROJECT_ROOT}`);
  if (!report.length) {
    console.log('No unused exports: every indexed export is imported somewhere in the scanned tree.');
    return;
  }
  for (const entry of report) {
    console.log(`\n  ${entry.file}`);
    for (const name of entry.unusedExports) console.log(`    - ${name}`);
  }
  console.log('\n' + '-'.repeat(50));
  console.log(`Total: ${totalUnused} unused export${totalUnused === 1 ? '' : 's'} across ${report.length} file${report.length === 1 ? '' : 's'}.`);

  if (totalUnused > 50) {
    const out = path.join(PROJECT_ROOT, 'unused-exports.json');
    fs.writeFileSync(out, JSON.stringify({
      scannedDir: PROJECT_ROOT,
      totalUnusedExports: totalUnused,
      filesWithUnusedExports: report.length,
      files: report,
    }, null, 2) + '\n', 'utf-8');
    console.log(`Over 50 unused exports — full report written to ${out}`);
  }
}

(async () => {
  if (UNUSED_MODE) {
    reportUnusedExports();
    rl.close();
    return;
  }
  for (const f of allFiles) {
    if (selfFiles.has(f)) continue;
    await fixFile(f);
  }
  console.log('\n' + '='.repeat(50));
  console.log(`Files scanned:    ${filesScanned}`);
  console.log(`Imports verified: ${importsVerified} (correct)`);
  console.log(`Imports broken:   ${importsBroken} (missing or wrong exports)`);
  console.log(`Imports fixed:    ${importsFixed}`);
  console.log(`Files modified:   ${filesModified}`);
  rl.close();
})();
