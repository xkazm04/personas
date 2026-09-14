// Fingerprint of everything that shapes a gate verdict. A change restarts the daemon.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

function listFiles(dir, pred, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) listFiles(p, pred, out);
    else if (e.isFile() && pred(e.name)) out.push(p);
  }
  return out;
}

/** The files hashed, as repo-relative posix paths, sorted. */
export function fingerprintInputs(baseRoot) {
  const abs = (p) => path.join(baseRoot, p);
  const files = [];
  for (const single of ['tsconfig.json', 'eslint.config.js', 'scripts/census/rules.json']) {
    if (fs.existsSync(abs(single))) files.push(abs(single));
  }
  listFiles(abs('eslint-rules'), () => true, files);
  listFiles(abs('scripts/census/lib'), (n) => n.endsWith('.mjs'), files);
  listFiles(abs('scripts/gate'), (n) => n.endsWith('.mjs'), files);
  for (const lock of ['package-lock.json', 'pnpm-lock.yaml']) {
    if (fs.existsSync(abs(lock))) files.push(abs(lock));
  }
  return [...new Set(files.map((f) => path.relative(baseRoot, f).replace(/\\/g, '/')))].sort();
}

export function computeFingerprint(baseRoot) {
  const h = crypto.createHash('sha256');
  for (const rel of fingerprintInputs(baseRoot)) {
    h.update(rel);
    h.update('\0');
    h.update(fs.readFileSync(path.join(baseRoot, rel)));
    h.update('\0');
  }
  return h.digest('hex');
}
