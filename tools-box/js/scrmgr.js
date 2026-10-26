#!/usr/bin/env node
/**
 * scrmgr.js
 * Category: util
 * Script manager: save, execute, edit, export, import JS utilities in SQLite database.
 * Reads: .js / .mjs files from filesystem or SQLite DB (scripts.db).
 * Processes: parses headers for Category/DESC, manages categories, runs scripts from temp files.
 * Outputs: console logs, DB updates, exported files to cwd.
 * Migrated to better-sqlite3 for synchronous, high-performance SQLite.
 */

import fs from 'fs';
import path from 'path';
import { spawn, execSync } from 'child_process';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import os from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = path.join(__dirname, 'scripts.db');
const db = new Database(DB_PATH);

// Synchronous DB wrappers (better-sqlite3)
function dbRun(sql, params = []) {
  const result = db.prepare(sql).run(...params);
  return { lastID: result.lastInsertRowid, changes: result.changes };
}

function dbGet(sql, params = []) {
  return db.prepare(sql).get(...params);
}

function dbAll(sql, params = []) {
  return db.prepare(sql).all(...params);
}

const CATEGORIES = [
  'tform',
  'build',
  'clean',
  'utilities',
  'map',
  'segment',
  'id',
  'report',
  'scan',
  'fix',
  'algo',
  'config',
];
const DESCRIPTIONS = {
  clean: 'Clean: scripts that delete or remove unnecessary text and data.',
  tform:
    'Tform (Transform): transforming JSON to TXT, Unicode code points to text, etc.',
  build:
    'Build: creating a certain data format from an input file to an output format.',
  utilities:
    'Utilities: manipulation beyond text files — folders, fixing, audit scripts, etc.',
  map: 'Map: character mapping, conversion, and renaming utilities.',
  segment: 'Segment: syllable segmentation, fixing, and tracing.',
  id: 'ID: syllable ID building, reversing, and tree auditing.',
  report: 'Report: generate reports from processed data.',
  scan: 'Scan: detect patterns, dead code, or specific characters.',
  fix: 'Fix: auto-fix paths, imports, and broken data.',
  algo: 'Algo: algorithms and reordering logic.',
  config: 'Config: build tool configurations.',
};

function findAvailableEditor() {
  const candidates = ['code', 'code-insiders', 'codium', 'nano', 'vim', 'vi'];
  for (const ed of candidates) {
    try {
      execSync(`command -v ${ed}`, { stdio: 'ignore' });
      return ed;
    } catch {
      continue;
    }
  }
  return null;
}

function getEditor() {
  return process.env.EDITOR || process.env.VISUAL || findAvailableEditor();
}

function showHelp() {
  console.log(`
Script Manager (ESM)
Commands:
  node scrmgr.js info
  node scrmgr.js info <category|filename.js>
  node scrmgr.js sav <filename> [category] [description...]
  node scrmgr.js sav all [directory] [category] [description...]
  node scrmgr.js exe <filename> [args...]
  node scrmgr.js edit <filename>
  node scrmgr.js export <filename|all>
  node scrmgr.js import <directory>
  node scrmgr.js list
  node scrmgr.js help
  node scrmgr.js del <filename>
  node scrmgr.js cat add <category-name> [description...]
  node scrmgr.js cat edit <category-name> <new-description>
  node scrmgr.js cat rereg <scriptname> <categoryname>

Auto-extract from file headers:
  // Category: segment     → auto-detected category
  // DESC: ...             → auto-detected description

Examples:
  node scrmgr.js info
  node scrmgr.js info segment
  node scrmgr.js info my.js
  node scrmgr.js sav my.js                    (auto-detect cat from header)
  node scrmgr.js sav my.js segment            (override category)
  node scrmgr.js sav my.js segment "My desc"  (override both)
  node scrmgr.js sav all ./                   (bulk save current dir)
  node scrmgr.js sav all ./utils segment      (bulk save with override cat)
  node scrmgr.js cat add mycategory long text as description
  node scrmgr.js cat edit mycategory Updated description here
  node scrmgr.js cat rereg my.js mycategory
`);
}

// HEADER EXTRACTION: Parse category & description from file comments

/**
 * Extract metadata from JS file header comments.
 * Supports formats:
 *   // Category: segment
 *   // category: segment
 *   // CAT: segment
 *   // DESC: description text
 *   // desc: description text
 *   // Description: description text
 *   /**
 *    * Category: segment
 *    * Description: ...
 *    *\/
 */
function extractHeaderMeta(content) {
  const result = { category: null, description: null };

  // Try block comments first (/** ... */)
  const blockMatch = content.match(/\/\*\*[\s\S]*?\*\//);
  if (blockMatch) {
    const block = blockMatch[0];
    const catMatch = block.match(
      /(?:Category|CAT|category)[\s]*[:-][\s]*([A-Za-z0-9_-]+)/,
    );
    if (catMatch) result.category = catMatch[1].toLowerCase().trim();

    const descMatch = block.match(
      /(?:Description|DESC|desc)[\s]*[:-][\s]*(.+?)(?:\n|\*\/)/,
    );
    if (descMatch) result.description = descMatch[1].trim();
  }

  // Also check first 20 lines for inline patterns
  const lines = content.split('\n').slice(0, 20);
  for (const line of lines) {
    const trimmed = line.trim();

    // Category patterns
    if (!result.category) {
      const catPatterns = [
        /^\/\/\s*Category\s*[:-]\s*(.+)$/i,
        /^\/\/\s*CAT\s*[:-]\s*(.+)$/i,
        /^\/\*\s*Category\s*[:-]\s*(.+)$/i,
        /^\*\s*Category\s*[:-]\s*(.+)$/i,
      ];
      for (const re of catPatterns) {
        const m = trimmed.match(re);
        if (m) {
          result.category = m[1].toLowerCase().trim();
          break;
        }
      }
    }

    // Description patterns
    if (!result.description) {
      const descPatterns = [
        /^\/\/\s*(?:Description|DESC)\s*[:-]\s*(.+)$/i,
        /^\/\*\s*(?:Description|DESC)\s*[:-]\s*(.+)$/i,
        /^\*\s*(?:Description|DESC)\s*[:-]\s*(.+)$/i,
        /^\/\/\s*(?:Desc|desc)\s*[:-]\s*(.+)$/i,
      ];
      for (const re of descPatterns) {
        const m = trimmed.match(re);
        if (m) {
          result.description = m[1].trim();
          break;
        }
      }
    }
  }

  return result;
}

function getScriptHeader(content) {
  const lines = content.split('\n');
  const header = [];
  for (const line of lines) {
    const t = line.trim();
    if (
      t.startsWith('//') ||
      t.startsWith('/*') ||
      t.startsWith('*') ||
      t.startsWith('#')
    ) {
      header.push(line);
    } else if (t === '' && header.length > 0) {
      header.push(line);
    } else if (header.length > 0) {
      break;
    }
  }
  return header.join('\n') || '(No header comments found)';
}

function openEditor(filePath) {
  const editor = getEditor();
  if (!editor) {
    throw new Error(
      'No editor found. Set EDITOR env var or install code/nano/vim.',
    );
  }
  return new Promise((resolve, reject) => {
    const child = spawn(editor, [filePath], {
      stdio: 'inherit',
      detached: false,
    });
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Editor exited with code ${code}`));
    });
    child.on('error', reject);
  });
}

async function initDb() {
  await dbRun(`CREATE TABLE IF NOT EXISTS scripts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT UNIQUE NOT NULL,
    category TEXT NOT NULL,
    description TEXT,
    content TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  await dbRun(`CREATE TABLE IF NOT EXISTS categories (
    name TEXT PRIMARY KEY,
    description TEXT
  )`);

  // Migrate old schema: add description column if missing
  try {
    await dbRun(`ALTER TABLE scripts ADD COLUMN description TEXT`);
  } catch {
    // Column already exists; ignore
  }

  try {
    await dbRun(`ALTER TABLE categories ADD COLUMN description TEXT`);
  } catch {
    // Column already exists; ignore
  }

  // Load persisted categories and descriptions
  const rows = await dbAll(`SELECT name, description FROM categories`);
  for (const row of rows) {
    if (!CATEGORIES.includes(row.name)) {
      CATEGORIES.push(row.name);
    }
    if (row.description) {
      DESCRIPTIONS[row.name] = row.description;
    }
  }

  // Ensure default categories exist in DB
  for (const cat of CATEGORIES) {
    const desc = DESCRIPTIONS[cat] || 'no description given';
    await dbRun(
      `INSERT OR IGNORE INTO categories (name, description) VALUES (?, ?)`,
      [cat, desc],
    );
  }
}

async function addCategory(category, description = 'no description given') {
  if (!category || category.trim() === '') {
    console.error(
      'Usage: node scrmgr.js cat add <category-name> [description...]',
    );
    process.exit(1);
  }
  const cleanCat = category.trim().toLowerCase();
  if (CATEGORIES.includes(cleanCat)) {
    console.log(`Category "${cleanCat}" already exists.`);
    return;
  }
  CATEGORIES.push(cleanCat);
  DESCRIPTIONS[cleanCat] = description;
  await dbRun(
    `INSERT OR IGNORE INTO categories (name, description) VALUES (?, ?)`,
    [cleanCat, description],
  );
  console.log(`Added new category: "${cleanCat}"`);
  if (description && description !== 'no description given') {
    console.log(`Description: ${description}`);
  }
}

async function editCategory(category, description) {
  if (!category || category.trim() === '') {
    console.error(
      'Usage: node scrmgr.js cat edit <category-name> <new-description>',
    );
    process.exit(1);
  }
  const cleanCat = category.trim().toLowerCase();
  if (!CATEGORIES.includes(cleanCat)) {
    console.error(
      `Category "${cleanCat}" does not exist. Use "cat add" to create it.`,
    );
    process.exit(1);
  }
  const cleanDesc = (description || '').trim();
  if (!cleanDesc) {
    console.error('Error: Description cannot be empty.');
    process.exit(1);
  }
  DESCRIPTIONS[cleanCat] = cleanDesc;
  await dbRun(`UPDATE categories SET description = ? WHERE name = ?`, [
    cleanDesc,
    cleanCat,
  ]);
  console.log(`Updated description for category "${cleanCat}".`);
  console.log(`New description: ${cleanDesc}`);
}

async function reassignScript(filename, category) {
  if (!filename || !category) {
    console.error(
      'Usage: node scrmgr.js cat rereg <scriptname> <categoryname>',
    );
    process.exit(1);
  }
  const cleanFile = path.basename(filename);
  const cleanCat = category.trim().toLowerCase();

  const row = await dbGet(`SELECT * FROM scripts WHERE filename = ?`, [
    cleanFile,
  ]);
  if (!row) {
    console.error(`Script not found in DB: ${cleanFile}`);
    process.exit(1);
  }

  if (!CATEGORIES.includes(cleanCat)) {
    console.log(
      `Category "${cleanCat}" does not exist. Creating it with default description.`,
    );
    await addCategory(cleanCat, 'no description given');
  }

  await dbRun(`UPDATE scripts SET category = ? WHERE filename = ?`, [
    cleanCat,
    cleanFile,
  ]);
  console.log(`Reassigned "${cleanFile}" → category "${cleanCat}"`);
}

async function listScripts() {
  const rows = await dbAll(
    `SELECT filename, category, description, created_at FROM scripts ORDER BY category, filename`,
  );
  if (!rows || rows.length === 0) {
    console.log('No scripts found in DB.');
    return;
  }
  console.log('Scripts in DB:');
  console.log('─'.repeat(80));
  console.log(
    `  ${'FILENAME'.padEnd(25)} | ${'CATEGORY'.padEnd(10)} | ${'DESCRIPTION'.padEnd(35)}`,
  );
  console.log('─'.repeat(80));
  for (const row of rows) {
    const desc = (row.description || '—').substring(0, 34);
    console.log(
      `  ${row.filename.padEnd(25)} | ${row.category.padEnd(10)} | ${desc}`,
    );
  }
  console.log('─'.repeat(80));
  console.log(`Total: ${rows.length} script(s)`);
}

// INFO: category summary, category description, or script header

async function showInfo(target) {
  if (!target) {
    const cats = await dbAll(
      `SELECT category, COUNT(*) as count FROM scripts GROUP BY category ORDER BY category`,
    );
    const total = await dbGet(`SELECT COUNT(*) as count FROM scripts`);
    console.log('Info:');
    console.log('─'.repeat(70));
    console.log(`Total scripts: ${total ? total.count : 0}`);
    console.log('');
    console.log(
      `  ${'CATEGORY'.padEnd(12)} ${'COUNT'.padStart(5)}  DESCRIPTION`,
    );
    console.log('  ' + '─'.repeat(66));
    for (const row of cats) {
      const desc = DESCRIPTIONS[row.category] || '';
      console.log(
        `  ${row.category.padEnd(12)} ${String(row.count).padStart(5)}  ${desc}`,
      );
    }
    console.log('─'.repeat(70));
    return;
  }

  if (CATEGORIES.includes(target)) {
    await showCategoryDescription(target);
    return;
  }

  const filename = path.basename(target);
  const row = await dbGet(`SELECT * FROM scripts WHERE filename = ?`, [
    filename,
  ]);
  if (!row) {
    console.error(`Script or category not found: ${target}`);
    process.exit(1);
  }
  console.log(`=== ${filename} ===`);
  console.log(`Category:    ${row.category}`);
  console.log(`Description: ${row.description || '—'}`);
  console.log(`Created:     ${row.created_at || '—'}`);
  console.log('');
  console.log(getScriptHeader(row.content));
}

// SAVE: Auto-extract category & description from file header

async function saveScript(filePath, category, description) {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    console.error(`File not found: ${resolved}`);
    process.exit(1);
  }

  const content = fs.readFileSync(resolved, 'utf-8');
  const filename = path.basename(resolved);

  // Auto-extract metadata from file header
  const meta = extractHeaderMeta(content);

  // Resolve category: CLI arg > header only. No filename fallback.
  let finalCategory = category;
  if (!finalCategory) {
    if (meta.category && CATEGORIES.includes(meta.category)) {
      finalCategory = meta.category;
      console.log(`Auto-detected category from header: "${finalCategory}"`);
    }
  }

  if (!finalCategory) {
    console.error(`No category provided and could not auto-detect from header.`);
    console.error(`Add header: // Category: <name> or provide category as argument.`);
    process.exit(1);
  }

  if (!CATEGORIES.includes(finalCategory)) {
    console.error(
      `Invalid category "${finalCategory}". Available: ${CATEGORIES.join(', ')}`,
    );
    process.exit(1);
  }

  // Resolve description: CLI arg > header > "default description"
  let finalDescription = description;
  if (!finalDescription) {
    if (meta.description) {
      finalDescription = meta.description;
      console.log(`Auto-detected description from header.`);
    } else {
      finalDescription = 'default description';
      console.log(`No description found; using "default description".`);
    }
  }

  const result = await dbRun(
    `INSERT OR REPLACE INTO scripts (filename, category, description, content) VALUES (?, ?, ?, ?)`,
    [filename, finalCategory, finalDescription, content],
  );

  console.log(
    `Saved "${filename}" → category "${finalCategory}" (row ${result.lastID})`,
  );
  console.log(`Description: ${finalDescription}`);
}

// SAVE ALL: Bulk save all .js files from a directory

async function saveAllScripts(dirPath, category, description) {
  const resolved = path.resolve(dirPath);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    console.error(`Not a directory: ${resolved}`);
    process.exit(1);
  }

  const entries = fs.readdirSync(resolved, { withFileTypes: true });
  const jsFiles = entries
    .filter(
      (e) => e.isFile() && (e.name.endsWith('.js') || e.name.endsWith('.mjs')),
    )
    .map((e) => path.join(resolved, e.name));

  if (jsFiles.length === 0) {
    console.log(`No .js/.mjs files found in ${resolved}`);
    return;
  }

  console.log(`Found ${jsFiles.length} script(s) in ${resolved}\n`);

  let saved = 0;
  let skipped = 0;
  let failed = 0;

  for (const filePath of jsFiles) {
    const filename = path.basename(filePath);

    // Skip if already exists in DB (collision check)
    const existing = await dbGet(`SELECT 1 FROM scripts WHERE filename = ?`, [
      filename,
    ]);
    if (existing) {
      console.log(`  [SKIP] "${filename}" — already exists in DB`);
      skipped++;
      continue;
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    const meta = extractHeaderMeta(content);

    // Resolve category: CLI arg > header only
    let finalCategory = category;
    if (!finalCategory) {
      if (meta.category && CATEGORIES.includes(meta.category)) {
        finalCategory = meta.category;
      }
    }

    if (!finalCategory) {
      console.log(
        `  [SKIP] "${filename}" — no category in header (add // Category: <name>)`,
      );
      skipped++;
      continue;
    }

    if (!CATEGORIES.includes(finalCategory)) {
      console.log(
        `  [SKIP] "${filename}" — unknown category "${finalCategory}"`,
      );
      skipped++;
      continue;
    }

    // Resolve description: CLI arg > header > "default description"
    let finalDescription = description;
    if (!finalDescription) {
      if (meta.description) {
        finalDescription = meta.description;
      } else {
        finalDescription = 'default description';
      }
    }

    try {
      await dbRun(
        `INSERT INTO scripts (filename, category, description, content) VALUES (?, ?, ?, ?)`,
        [filename, finalCategory, finalDescription, content],
      );
      console.log(`  [SAVED] "${filename}" → ${finalCategory}`);
      saved++;
    } catch (err) {
      console.log(`  [FAIL] "${filename}" — ${err.message}`);
      failed++;
    }
  }

  console.log(`\nDone: ${saved} saved, ${skipped} skipped, ${failed} failed.`);
}

async function deleteScript(filename) {
  const row = await dbGet(`SELECT * FROM scripts WHERE filename = ?`, [
    filename,
  ]);
  if (!row) {
    console.error(`Script not found in DB: ${filename}`);
    process.exit(1);
  }
  await dbRun(`DELETE FROM scripts WHERE filename = ?`, [filename]);
  console.log(`Deleted "${filename}" from DB`);
}

async function executeScript(filename, extraArgs) {
  const row = await dbGet(`SELECT * FROM scripts WHERE filename = ?`, [
    filename,
  ]);
  if (!row) {
    console.error(`Script not found in DB: ${filename}`);
    process.exit(1);
  }
  const tmpFile = path.join(__dirname, `.tmp_${Date.now()}_${filename}`);
  fs.writeFileSync(tmpFile, row.content, 'utf-8');
  const ext = path.extname(filename).toLowerCase();
  let command, args;
  if (ext === '.sh') {
    fs.chmodSync(tmpFile, 0o755);
    command = 'bash';
    args = [tmpFile, ...extraArgs];
  } else if (ext === '.py') {
    command = 'python3';
    args = [tmpFile, ...extraArgs];
  } else {
    command = process.execPath;
    args = [tmpFile, ...extraArgs];
  }
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      cwd: process.cwd(),
    });
    child.on('close', (code) => {
      try {
        fs.unlinkSync(tmpFile);
      } catch {} // eslint-disable-line no-empty -- best-effort cleanup
      resolve(code || 0);
    });
    child.on('error', (err) => {
      console.error('Execution error:', err.message);
      try {
        fs.unlinkSync(tmpFile);
      } catch {} // eslint-disable-line no-empty -- best-effort cleanup
      resolve(1);
    });
  });
}

async function editScript(filename) {
  const row = await dbGet(`SELECT * FROM scripts WHERE filename = ?`, [
    filename,
  ]);
  if (!row) {
    console.error(`Script not found in DB: ${filename}`);
    process.exit(1);
  }
  const tmpFile = path.join(
    os.tmpdir(),
    `.script_edit_${Date.now()}_${filename}`,
  );
  fs.writeFileSync(tmpFile, row.content, 'utf-8');
  console.log(`Opening "${filename}" in ${getEditor() || '(none found)'}`);
  try {
    await openEditor(tmpFile);
    const newContent = fs.readFileSync(tmpFile, 'utf-8');
    if (newContent === row.content) {
      console.log('No changes detected. DB not updated.');
    } else {
      // Re-extract metadata from edited content
      const newMeta = extractHeaderMeta(newContent);
      const updates = { content: newContent };

      if (newMeta.category && newMeta.category !== row.category) {
        updates.category = newMeta.category;
        console.log(
          `Category changed in header: "${row.category}" → "${newMeta.category}"`,
        );
      }
      if (newMeta.description && newMeta.description !== row.description) {
        updates.description = newMeta.description;
        console.log(`Description changed in header.`);
      }

      const fields = Object.keys(updates)
        .map((k) => `${k} = ?`)
        .join(', ');
      const values = [...Object.values(updates), filename];
      await dbRun(`UPDATE scripts SET ${fields} WHERE filename = ?`, values);
      console.log(`Updated "${filename}" in DB.`);
    }
  } catch (err) {
    console.error('Edit failed:', err.message);
  } finally {
    try {
      fs.unlinkSync(tmpFile);
    } catch {} // eslint-disable-line no-empty -- best-effort cleanup
  }
}

async function exportScript(filename) {
  if (filename === 'all') {
    const rows = await dbAll(
      `SELECT filename, content FROM scripts ORDER BY filename`,
    );
    if (!rows || rows.length === 0) {
      console.log('No scripts found in DB to export.');
      return;
    }

    let exported = 0;
    for (const row of rows) {
      const outName = row.filename; // strip prefix
      const outPath = path.join(process.cwd(), outName);
      fs.writeFileSync(outPath, row.content, 'utf-8');
      console.log(`  Exported "${row.filename}" → ${outPath}`);
      exported++;
    }
    console.log(`\nDone: ${exported} script(s) exported.`);
    return;
  }

  const row = await dbGet(`SELECT * FROM scripts WHERE filename = ?`, [
    filename,
  ]);
  if (!row) {
    console.error(`Script not found in DB: ${filename}`);
    process.exit(1);
  }
  const outName = row.filename; // strip prefix
  const outPath = path.join(process.cwd(), outName);
  fs.writeFileSync(outPath, row.content, 'utf-8');
  console.log(`Exported "${filename}" → ${outPath}`);
}

async function importDirectory(directory) {
  const dirPath = path.resolve(directory || process.cwd());
  if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
    console.error(`Not a directory: ${dirPath}`);
    process.exit(1);
  }

  const rows = await dbAll(`SELECT filename FROM scripts ORDER BY filename`);
  if (!rows || rows.length === 0) {
    console.log('No scripts in DB to import updates for.');
    return;
  }

  let updated = 0;
  let skipped = 0;

  for (const row of rows) {
    const filename = row.filename;
    // Try exact filename first, then fallback to old script.* prefix
    let filePath = path.join(dirPath, filename);
    if (!fs.existsSync(filePath)) {
      const prefixedPath = path.join(dirPath, `script.${filename}`);
      if (fs.existsSync(prefixedPath)) {
        filePath = prefixedPath;
      } else {
        console.log(
          `  [SKIP] "${filename}" — not found in ${dirPath}`,
        );
        skipped++;
        continue;
      }
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    await dbRun(`UPDATE scripts SET content = ? WHERE filename = ?`, [
      content,
      filename,
    ]);
    console.log(`  [UPDATED] "${filename}" from ${filePath}`);
    updated++;
  }

  console.log(`\nDone: ${updated} updated, ${skipped} skipped.`);
}

async function showCategoryDescription(category) {
  const desc = DESCRIPTIONS[category];
  if (desc) {
    console.log(`${category.toUpperCase()}\n${desc}`);
  } else {
    console.error(
      `Unknown category: ${category}. Available: ${CATEGORIES.join(', ')}`,
    );
    process.exit(1);
  }
}

// eslint-disable-next-line no-unused-vars -- intentional unused variable in test/experimental code
async function showScriptHeader(filename) {
  const row = await dbGet(`SELECT * FROM scripts WHERE filename = ?`, [
    filename,
  ]);
  if (!row) {
    console.error(`Script not found in DB: ${filename}`);
    process.exit(1);
  }
  console.log(`=== ${filename} ===`);
  console.log(`Category: ${row.category}`);
  console.log(`Description: ${row.description || '—'}`);
  console.log('');
  console.log(getScriptHeader(row.content));
}

(async () => {
  await initDb();
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === 'help') {
    showHelp();
    db.close();
    return;
  }

  const cmd = args[0];

  switch (cmd) {
    case 'list': {
      await listScripts();
      break;
    }

    case 'info':
    case 'what': {
      if (args.length < 2) {
        await showInfo();
      } else {
        await showInfo(args[1]);
      }
      break;
    }

    case 'del': {
      if (args.length < 2) {
        console.error('Usage: node scrmgr.js del <filename>');
        db.close();
        process.exit(1);
      }
      const filename = path.basename(args[1]);
      await deleteScript(filename);
      break;
    }

    case 'sav': {
      if (args.length < 2) {
        console.error(
          'Usage: node scrmgr.js sav <filename|all> [category] [description...]',
        );
        console.error(
          '         node scrmgr.js sav all [directory] [category] [description...]',
        );
        db.close();
        process.exit(1);
      }

      // Handle 'sav all' — bulk save all .js files from directory
      if (args[1].toLowerCase() === 'all') {
        const dirPath = args[2] || '.';
        // Check if arg[2] is a directory or a category
        // eslint-disable-next-line no-useless-assignment -- redundant null init before conditional reassignment
        let description = null;
        let actualDir = dirPath;

        // If dirPath is actually a category, use current dir
        if (CATEGORIES.includes(dirPath.toLowerCase())) {
          category = dirPath.toLowerCase();
          actualDir = '.';
          description = args.slice(3).join(' ') || null;
        } else {
          // dirPath is a real path — check if next arg is category
          if (args.length >= 4 && CATEGORIES.includes(args[3].toLowerCase())) {
            category = args[3].toLowerCase();
            description = args.slice(4).join(' ') || null;
          } else {
            description = args.slice(3).join(' ') || null;
          }
        }

        await saveAllScripts(actualDir, category, description);
        break;
      }

      // Single file save
      const filePath = args[1];
      let category = null;
      let description = null;

      if (args.length >= 3) {
        const maybeCat = args[2].toLowerCase().trim();
        if (CATEGORIES.includes(maybeCat)) {
          category = maybeCat;
          description = args.slice(3).join(' ') || null;
        } else {
          description = args.slice(2).join(' ');
        }
      }

      await saveScript(filePath, category, description);
      break;
    }

    case 'exe': {
      if (args.length < 2) {
        console.error('Usage: node scrmgr.js exe <filename> [args...]');
        db.close();
        process.exit(1);
      }
      const filename = path.basename(args[1]);
      const extraArgs = args.slice(2);
      const exitCode = await executeScript(filename, extraArgs);
      db.close();
      process.exit(exitCode);
    }

    /* eslint-disable-next-line no-fallthrough -- process.exit always terminates, no actual fallthrough */
    case 'edit': {
      if (args.length < 2) {
        console.error('Usage: node scrmgr.js edit <filename>');
        db.close();
        process.exit(1);
      }
      const filename = path.basename(args[1]);
      await editScript(filename);
      break;
    }

    case 'export': {
      if (args.length < 2) {
        console.error('Usage: node scrmgr.js export <filename|all>');
        db.close();
        process.exit(1);
      }
      const filename = args[1] === 'all' ? 'all' : path.basename(args[1]);
      await exportScript(filename);
      break;
    }

    case 'cat': {
      if (args.length < 3) {
        console.error('Usage: node scrmgr.js cat <add|edit|rereg> ...');
        showHelp();
        db.close();
        process.exit(1);
      }
      const subCmd = args[1];
      if (subCmd === 'add') {
        const category = args[2];
        const description = args.slice(3).join(' ') || 'no description given';
        await addCategory(category, description);
      } else if (subCmd === 'edit') {
        if (args.length < 4) {
          console.error(
            'Usage: node scrmgr.js cat edit <category-name> <new-description>',
          );
          db.close();
          process.exit(1);
        }
        const category = args[2];
        const description = args.slice(3).join(' ');
        await editCategory(category, description);
      } else if (subCmd === 'rereg') {
        if (args.length < 4) {
          console.error(
            'Usage: node scrmgr.js cat rereg <scriptname> <categoryname>',
          );
          db.close();
          process.exit(1);
        }
        const filename = path.basename(args[2]);
        const category = args[3];
        await reassignScript(filename, category);
      } else {
        console.error(`Unknown subcommand: ${subCmd}`);
        showHelp();
        db.close();
        process.exit(1);
      }
      break;
    }

    case 'import': {
      if (args.length < 2) {
        console.error('Usage: node scrmgr.js import <directory>');
        db.close();
        process.exit(1);
      }
      await importDirectory(args[1]);
      break;
    }

    default: {
      console.error(`Unknown command: ${cmd}`);
      showHelp();
      db.close();
      process.exit(1);
    }
  }

  db.close();
})();
