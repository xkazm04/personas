// Warm TypeScript worker: ONE SemanticDiagnosticsBuilderProgram for the base checkout,
// answering every request by overlaying a worktree's changed files through the
// CompilerHost and rebuilding incrementally.
//
// Protocol (worker_threads):
//   -> { type: 'ready', ms }                         once warm
//   <- { id, type: 'gate', root, base, overlay }     -> { id, ok: true, result } | { id, ok: false, error }
//   <- { type: 'invalidate', paths: [abs...] }       (no reply)
//   <- { id, type: 'status' }                        -> { id, ok: true, result }
//
// Result: { ok, errors, introduced, resolved, baseErrors, ms, reused, reuse, filesRechecked,
//           changedFiles, rootNames }
//   ok = no `introduced` when root !== base; = zero errors when root === base.

import { parentPort, workerData } from 'node:worker_threads';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const baseRoot = path.resolve(workerData.baseRoot).replace(/\\/g, '/');

function loadTypeScript() {
  try {
    return createRequire(path.join(baseRoot, 'package.json'))('typescript');
  } catch {
    return createRequire(import.meta.url)('typescript');
  }
}
const ts = loadTypeScript();

const useCaseSensitiveFileNames = ts.sys.useCaseSensitiveFileNames;
const configPath = baseRoot + '/tsconfig.json';

// ---------------------------------------------------------------------------
// path helpers
const norm = (p) => ts.normalizeSlashes(path.resolve(baseRoot, p));
const keyOf = (p) => {
  const n = norm(p);
  return useCaseSensitiveFileNames ? n : n.toLowerCase();
};
const dirKeyOf = (p) => keyOf(path.posix.dirname(norm(p)));

// ---------------------------------------------------------------------------
// caches
/** disk text: key -> { mtimeMs, size, text } (stat-validated on every read) */
const diskText = new Map();
/** directory listing: key -> { files: string[], directories: string[] } (cleared on invalidate) */
const dirEntries = new Map();
/** parsed SourceFiles: key -> { hash, sf } (same object returned while content hash is unchanged) */
const sfCache = new Map();

/** current request overlay: key -> { status, content?, binary? } */
let overlayMap = new Map();
/** current request overlay directory index: dirKey -> { files: Set<name>, dirs: Set<name> } */
let overlayDirs = new Map();

let oldProgram;
let baseDiagnostics = null;
let baseDirty = true;
let lastRootNames = [];
let lastBuildMs = 0;
let lastOptionsKey = '';

function sha1(text) {
  return crypto.createHash('sha1').update(text).digest('hex');
}

// ---------------------------------------------------------------------------
// overlay
function setOverlay(files) {
  overlayMap = new Map();
  overlayDirs = new Map();
  for (const f of files || []) {
    const abs = norm(baseRoot + '/' + f.path);
    overlayMap.set(keyOf(abs), { status: f.status, content: f.content, binary: f.binary, abs });
    if (f.status === 'deleted') {
      const dk = dirKeyOf(abs);
      const e = overlayDirs.get(dk) || { files: new Set(), dirs: new Set(), deleted: new Set() };
      e.deleted.add(path.posix.basename(abs));
      overlayDirs.set(dk, e);
      continue;
    }
    // register the file and every ancestor directory that may not exist on base disk
    let child = abs;
    let parent = path.posix.dirname(abs);
    let first = true;
    while (parent && parent !== child) {
      const dk = keyOf(parent);
      const e = overlayDirs.get(dk) || { files: new Set(), dirs: new Set(), deleted: new Set() };
      if (first) e.files.add(path.posix.basename(child));
      else e.dirs.add(path.posix.basename(child));
      overlayDirs.set(dk, e);
      first = false;
      if (keyOf(parent) === keyOf(baseRoot)) break;
      child = parent;
      parent = path.posix.dirname(parent);
    }
  }
}

function overlayGet(fileName) {
  return overlayMap.get(keyOf(fileName));
}

// ---------------------------------------------------------------------------
// disk access (stat-validated cache)
function readDisk(fileName) {
  const abs = norm(fileName);
  const key = keyOf(abs);
  let st;
  try {
    st = fs.statSync(abs);
  } catch {
    diskText.delete(key);
    return undefined;
  }
  if (!st.isFile()) {
    diskText.delete(key);
    return undefined;
  }
  const c = diskText.get(key);
  if (c && c.mtimeMs === st.mtimeMs && c.size === st.size) return c.text;
  const text = ts.sys.readFile(abs);
  if (text === undefined) return undefined;
  diskText.set(key, { mtimeMs: st.mtimeMs, size: st.size, text });
  return text;
}

function diskFileExists(fileName) {
  try {
    return fs.statSync(norm(fileName)).isFile();
  } catch {
    return false;
  }
}

function diskDirectoryExists(dirName) {
  try {
    return fs.statSync(norm(dirName)).isDirectory();
  } catch {
    return false;
  }
}

function readDirEntries(dirName) {
  const abs = norm(dirName);
  const key = keyOf(abs);
  const cached = dirEntries.get(key);
  if (cached) return cached;
  const entry = { files: [], directories: [] };
  let list = [];
  try {
    list = fs.readdirSync(abs, { withFileTypes: true });
  } catch {
    dirEntries.set(key, entry);
    return entry;
  }
  for (const d of list) {
    let isFile = d.isFile();
    let isDir = d.isDirectory();
    if (d.isSymbolicLink()) {
      try {
        const st = fs.statSync(abs + '/' + d.name);
        isFile = st.isFile();
        isDir = st.isDirectory();
      } catch {
        continue;
      }
    }
    if (isFile) entry.files.push(d.name);
    else if (isDir) entry.directories.push(d.name);
  }
  entry.files.sort();
  entry.directories.sort();
  dirEntries.set(key, entry);
  return entry;
}

// ---------------------------------------------------------------------------
// overlay-aware file system view
function fileExists(fileName) {
  const ov = overlayGet(fileName);
  if (ov) return ov.status !== 'deleted';
  return diskFileExists(fileName);
}

function readFile(fileName) {
  const ov = overlayGet(fileName);
  if (ov) {
    if (ov.status === 'deleted') return undefined;
    if (ov.content !== undefined) return ov.content;
  }
  return readDisk(fileName);
}

function directoryExists(dirName) {
  if (overlayDirs.has(keyOf(dirName))) {
    const e = overlayDirs.get(keyOf(dirName));
    if (e.files.size || e.dirs.size) return true;
  }
  return diskDirectoryExists(dirName);
}

/** Merged (disk + overlay) listing; shape matches ts.matchFiles' getFileSystemEntries. */
function getFileSystemEntries(dirName) {
  const disk = readDirEntries(dirName);
  const ov = overlayDirs.get(keyOf(dirName));
  if (!ov) return disk;
  const files = new Set(disk.files);
  const directories = new Set(disk.directories);
  for (const f of ov.deleted) files.delete(f);
  for (const f of ov.files) files.add(f);
  for (const d of ov.dirs) directories.add(d);
  return { files: [...files].sort(), directories: [...directories].sort() };
}

function readDirectory(rootDir, extensions, excludes, includes, depth) {
  return ts.matchFiles(
    rootDir,
    extensions,
    excludes,
    includes,
    useCaseSensitiveFileNames,
    baseRoot,
    depth,
    getFileSystemEntries,
    (p) => p,
  );
}

function getDirectories(dirName) {
  return getFileSystemEntries(dirName).directories;
}

// ---------------------------------------------------------------------------
// config + host
function parseConfig() {
  const host = {
    useCaseSensitiveFileNames,
    fileExists,
    readFile,
    readDirectory,
    getCurrentDirectory: () => baseRoot,
    onUnRecoverableConfigFileDiagnostic: (d) => {
      throw new Error('tsconfig: ' + ts.flattenDiagnosticMessageText(d.messageText, '\n'));
    },
  };
  const parsed = ts.getParsedCommandLineOfConfigFile(configPath, { noEmit: true }, host);
  if (!parsed) throw new Error('could not parse ' + configPath);
  return parsed;
}

function createHost(options) {
  const host = ts.createIncrementalCompilerHost(options, ts.sys);
  host.getCurrentDirectory = () => baseRoot;
  host.fileExists = fileExists;
  host.readFile = readFile;
  host.directoryExists = directoryExists;
  host.getDirectories = getDirectories;
  host.readDirectory = readDirectory;
  host.realpath = (p) => (overlayGet(p) ? norm(p) : ts.sys.realpath ? ts.sys.realpath(p) : p);
  host.getSourceFile = (fileName, languageVersionOrOptions, onError) => {
    let text;
    try {
      text = readFile(fileName);
    } catch (e) {
      if (onError) onError(String(e && e.message));
      return undefined;
    }
    if (text === undefined) return undefined;
    const key = keyOf(fileName);
    const hash = sha1(text);
    const cached = sfCache.get(key);
    if (cached && cached.hash === hash) return cached.sf;
    const sf = ts.createSourceFile(fileName, text, languageVersionOrOptions);
    sf.version = hash;
    sfCache.set(key, { hash, sf });
    return sf;
  };
  return host;
}

// ---------------------------------------------------------------------------
// diagnostics
function relPath(fileName) {
  const abs = norm(fileName);
  const rel = path.posix.relative(baseRoot, abs);
  return rel.startsWith('..') ? abs : rel;
}

function toEntry(d) {
  let file = '';
  let line = 0;
  let col = 0;
  if (d.file) {
    file = relPath(d.file.fileName);
    if (typeof d.start === 'number') {
      const lc = d.file.getLineAndCharacterOfPosition(d.start);
      line = lc.line + 1;
      col = lc.character + 1;
    }
  }
  return {
    file,
    line,
    col,
    code: d.code,
    message: ts.flattenDiagnosticMessageText(d.messageText, '\n'),
  };
}

const entryKey = (e) => `${e.file} ${e.code} ${e.message}`;

/** Multiset difference a \ b, keyed by file+code+message (line-insensitive). */
function multisetDiff(a, b) {
  const counts = new Map();
  for (const e of b) counts.set(entryKey(e), (counts.get(entryKey(e)) || 0) + 1);
  const out = [];
  for (const e of a) {
    const k = entryKey(e);
    const n = counts.get(k) || 0;
    if (n > 0) counts.set(k, n - 1);
    else out.push(e);
  }
  return out;
}

/** Build (or rebuild) the program against the current overlay and return error entries. */
function build() {
  const t0 = performance.now();
  const parsed = parseConfig();
  const optionsKey = JSON.stringify(parsed.options);
  if (optionsKey !== lastOptionsKey) {
    lastOptionsKey = optionsKey;
  }
  const host = createHost(parsed.options);
  const program = ts.createSemanticDiagnosticsBuilderProgram(
    parsed.fileNames,
    parsed.options,
    host,
    oldProgram,
    parsed.errors,
    parsed.projectReferences,
  );
  const inner = program.getProgram();
  const structureIsReused = inner.structureIsReused ?? 0;
  const state = program.state;
  const totalFiles = inner.getSourceFiles().length;
  const changedFiles = state && state.changedFilesSet ? state.changedFilesSet.size : null;
  // which files the builder saw as changed since the previous program (capped; explains a recheck)
  const changedPaths = state && state.changedFilesSet ? [...state.changedFilesSet].slice(0, 20).map(relPath) : [];

  // Drive the builder's affected-file loop ourselves so the count is exact: the builder
  // prunes dependents of a changed file lazily, so reading its cache size up front
  // under-reports. Diagnostics computed here are cached and returned by
  // getSemanticDiagnostics() below without recomputation.
  let affected = 0;
  while (program.getSemanticDiagnosticsOfNextAffectedFile()) affected++;
  // files whose shape-dependents lost their cached diagnostics are rechecked by
  // getSemanticDiagnostics() below; they are the gap between the program and the cache
  const cachedNow = state && state.semanticDiagnosticsPerFile ? state.semanticDiagnosticsPerFile.size : totalFiles;
  const filesRechecked = affected + Math.max(0, totalFiles - cachedNow);

  const diags = [
    ...program.getConfigFileParsingDiagnostics(),
    ...program.getSyntacticDiagnostics(),
    ...program.getOptionsDiagnostics(),
    ...program.getGlobalDiagnostics(),
    ...program.getSemanticDiagnostics(),
  ];
  const sorted = ts.sortAndDeduplicateDiagnostics(diags);
  const errors = [];
  for (const d of sorted) {
    if (d.category === ts.DiagnosticCategory.Error) errors.push(toEntry(d));
  }
  oldProgram = program;
  lastRootNames = parsed.fileNames.map(relPath);
  // the previous program (and its checker) is unreachable now; hand it back promptly so
  // the daemon's RSS reflects one warm program, not two (needs --expose-gc; no-op otherwise)
  if (typeof globalThis.gc === 'function') globalThis.gc();
  lastBuildMs = Math.round(performance.now() - t0);
  return {
    errors,
    ms: lastBuildMs,
    reused: structureIsReused !== 0,
    reuse: structureIsReused === 2 ? 'completely' : structureIsReused === 1 ? 'safe-modules' : 'not',
    filesRechecked,
    changedFiles,
    changedPaths,
    totalFiles,
    rootNames: lastRootNames.length,
  };
}

function refreshBase() {
  setOverlay([]);
  const r = build();
  baseDiagnostics = r.errors;
  baseDirty = false;
  return r;
}

function handleGate(msg) {
  const t0 = performance.now();
  const files = (msg.overlay && msg.overlay.files) || [];
  const isBase = files.length === 0;
  let baseBuild = null;
  if (isBase || baseDirty || !baseDiagnostics) baseBuild = refreshBase();
  if (isBase) {
    return {
      ok: baseBuild.errors.length === 0,
      errors: baseBuild.errors,
      introduced: [],
      resolved: [],
      baseErrors: baseBuild.errors.length,
      ms: Math.round(performance.now() - t0),
      buildMs: baseBuild.ms,
      reused: baseBuild.reused,
      reuse: baseBuild.reuse,
      filesRechecked: baseBuild.filesRechecked,
      changedFiles: baseBuild.changedFiles,
    changedPaths: baseBuild.changedPaths,
      totalFiles: baseBuild.totalFiles,
      rootNames: baseBuild.rootNames,
      overlayFiles: 0,
    };
  }
  setOverlay(files);
  let r;
  try {
    r = build();
  } finally {
    setOverlay([]);
  }
  const introduced = multisetDiff(r.errors, baseDiagnostics);
  const resolved = multisetDiff(baseDiagnostics, r.errors);
  return {
    ok: introduced.length === 0,
    errors: r.errors,
    introduced,
    resolved,
    baseErrors: baseDiagnostics.length,
    ms: Math.round(performance.now() - t0),
    buildMs: r.ms,
    baseRefreshMs: baseBuild ? baseBuild.ms : 0,
    reused: r.reused,
    reuse: r.reuse,
    filesRechecked: r.filesRechecked,
    changedFiles: r.changedFiles,
    changedPaths: r.changedPaths,
    totalFiles: r.totalFiles,
    rootNames: r.rootNames,
    overlayFiles: files.length,
  };
}

function handleInvalidate(paths) {
  dirEntries.clear();
  for (const p of paths || []) {
    const key = keyOf(p);
    diskText.delete(key);
    sfCache.delete(key);
  }
  baseDirty = true;
}

function handleStatus() {
  return {
    rootNames: lastRootNames.length,
    baseErrors: baseDiagnostics ? baseDiagnostics.length : null,
    baseDirty,
    lastBuildMs,
    rssMb: Math.round(process.memoryUsage().rss / 1048576),
    heapUsedMb: Math.round(process.memoryUsage().heapUsed / 1048576),
    cachedSourceFiles: sfCache.size,
    typescript: ts.version,
  };
}

// ---------------------------------------------------------------------------
// message loop
parentPort.on('message', (msg) => {
  try {
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'invalidate') {
      handleInvalidate(msg.paths);
      return;
    }
    if (msg.type === 'status') {
      parentPort.postMessage({ id: msg.id, ok: true, result: handleStatus() });
      return;
    }
    if (msg.type === 'gate') {
      const result = handleGate(msg);
      parentPort.postMessage({ id: msg.id, ok: true, result });
      return;
    }
    if (msg.id !== undefined) {
      parentPort.postMessage({ id: msg.id, ok: false, error: `unknown message type ${msg.type}` });
    }
  } catch (e) {
    if (msg && msg.id !== undefined) {
      parentPort.postMessage({ id: msg.id, ok: false, error: (e && e.stack) || String(e) });
    }
  }
});

process.on('uncaughtException', (e) => {
  parentPort.postMessage({ type: 'log', level: 'error', message: 'uncaught: ' + ((e && e.stack) || String(e)) });
});

// warm up
(() => {
  const t0 = performance.now();
  try {
    if (!fs.existsSync(configPath)) throw new Error(`no tsconfig.json at ${baseRoot}`);
    const r = refreshBase();
    parentPort.postMessage({
      type: 'ready',
      ms: Math.round(performance.now() - t0),
      baseErrors: r.errors.length,
      rootNames: r.rootNames,
      totalFiles: r.totalFiles,
    });
  } catch (e) {
    parentPort.postMessage({ type: 'fatal', error: (e && e.stack) || String(e) });
  }
})();
