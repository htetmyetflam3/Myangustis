// Site entry point (shared by public + authenticated callers)
// Original: F.Site/Backend/file/praser.js
// Function: createPraserParser(label) → { parse(filePath, out, options) }
// Calls: manager.dispatch({...routing, inPath, filename, inputKind, outPath}, 'site', authenticatedUser)
// Two call modes: public (no identity) and authenticated (identity = authenticatedUser)
// Path: site → Manager.dispatch('site', ...) → #dispatch → #submit → shared workers → shared modules
