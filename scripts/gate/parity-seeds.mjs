// Seeds shared by parity.mjs (daemon vs cold) and tsgo-diff.mjs (TS 6 vs the native checker).
//
// SEEDING NEVER LEAVES A MARK. New files live in one directory that the undo removes; the
// one tracked file that is edited must be clean before the seed (`git diff --quiet`), is
// restored from the bytes read before the edit, and is then verified twice: sha256 of the
// bytes and `git diff --quiet -- <file>`. Nothing here touches the index.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

export const SEED_DIR = 'src/lib/__gate_parity_seed__';
export const HUB_FILE = 'src/lib/silentCatch.ts';
export const HUB_FROM = 'export function silentCatch(context: string)';
export const HUB_TO = 'export function silentCatch(context: number)';

export const CASES = {
  clean: { note: 'tree as it stands', files: {} },
  leaf: {
    note: 'type error in a new leaf file',
    files: { 'leaf.ts': 'export const gateParityLeaf: number = "not a number";\n' },
  },
  hub: { note: `signature change in ${HUB_FILE}`, hub: true, files: {} },
  census: {
    note: 'census rise: raw <select>',
    files: { 'CensusRise.tsx': 'export const GateParityCensusRise = () => <select />;\n' },
  },
  eslint: {
    note: 'error-level lint: custom/no-silent-catch',
    files: { 'lintError.ts': 'export function gateParityLint(f: () => void): void {\n  try {\n    f();\n  } catch {}\n}\n' },
  },
};

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

/** Applies `spec` under `root`; returns the undo. Throws `{ cannotRun: true }` rather than seed over someone's edit. */
export function seed(root, spec) {
  const undo = [];
  if (Object.keys(spec.files).length) {
    const dir = path.join(root, SEED_DIR);
    if (fs.existsSync(dir)) throw Object.assign(new Error(`${SEED_DIR} already exists; a previous run died mid-seed. Remove it and re-run.`), { cannotRun: true });
    fs.mkdirSync(dir, { recursive: true });
    undo.push(() => fs.rmSync(dir, { recursive: true, force: true }));
    for (const [name, text] of Object.entries(spec.files)) fs.writeFileSync(path.join(dir, name), text);
  }
  if (spec.hub) {
    const abs = path.join(root, HUB_FILE);
    if (spawnSync('git', ['-C', root, 'diff', '--quiet', '--', HUB_FILE]).status !== 0) {
      throw Object.assign(new Error(`${HUB_FILE} is already dirty; refusing to seed over someone's edit`), { cannotRun: true });
    }
    const original = fs.readFileSync(abs);
    const text = original.toString('utf8');
    if (text.split(HUB_FROM).length !== 2) throw Object.assign(new Error(`${HUB_FILE}: seed anchor not found exactly once`), { cannotRun: true });
    undo.push(() => {
      fs.writeFileSync(abs, original);
      const back = fs.readFileSync(abs);
      const clean = spawnSync('git', ['-C', root, 'diff', '--quiet', '--', HUB_FILE]).status === 0;
      if (sha(back) !== sha(original) || !clean) throw new Error(`RESTORE FAILED for ${HUB_FILE}: fix it by hand before doing anything else`);
    });
    fs.writeFileSync(abs, text.replace(HUB_FROM, HUB_TO));
  }
  return () => {
    for (const u of undo.reverse()) u();
  };
}
