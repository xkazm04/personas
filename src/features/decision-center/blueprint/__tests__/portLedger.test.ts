// @vitest-environment node
/**
 * The bp port ledger (../bp-port.json) against the tree: every file Personas ported from bp is listed with the bp
 * path(s) it follows and the bp commit it was ported at, and the file's own header names that same commit. The ledger is
 * what scripts/bp/port-drift.mjs reads to report which ports bp has moved past; this test needs no bp checkout.
 * A file whose first five lines say `PORTED ... from bp` and that is not in the ledger fails here, and so does a ledger
 * entry whose file is gone or whose header names another commit.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import ledgerRaw from '../bp-port.json?raw';

interface PortEntry { file: string; bp: string[]; sha: string; basis: 'stated' | 'inferred'; kind: 'verbatim' | 'port' | 'golden' }
interface PortLedger { bp_repo: string; synced_to: string; synced_at: string; files: PortEntry[] }

// Invariant that makes this cast safe: the shape is asserted field by field in the first test below.
const ledger = JSON.parse(ledgerRaw) as PortLedger;
const ROOT = process.cwd();
const SHA = /^[0-9a-f]{7,40}$/;
const HEADER_LINES = 5;
const PORTED = /PORTED[\s\S]*?from bp\b/;

const headOf = (file: string) => readFileSync(resolve(ROOT, file), 'utf8').replace(/\r\n/g, '\n').split('\n').slice(0, HEADER_LINES).join('\n');

/** Every source file under src/ whose header says it was ported from bp, repo-relative with forward slashes. */
function portedFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p); continue; }
      if (!/\.(ts|tsx|mts|mjs|js)$/.test(e.name)) continue;
      const rel = relative(ROOT, p).split('\\').join('/');
      if (PORTED.test(headOf(rel))) out.push(rel);
    }
  };
  walk(resolve(ROOT, 'src'));
  return out.sort();
}

describe('the bp port ledger', () => {
  it('is well formed', () => {
    expect(ledger.bp_repo).toBe('../bp');
    expect(ledger.synced_to).toMatch(SHA);
    expect(ledger.synced_at).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(ledger.files.length).toBeGreaterThan(0);
    for (const f of ledger.files) {
      expect(f.sha, f.file).toMatch(SHA);
      expect(['stated', 'inferred'], f.file).toContain(f.basis);
      expect(['verbatim', 'port', 'golden'], f.file).toContain(f.kind);
      expect(f.bp.length, f.file).toBeGreaterThan(0);
    }
  });

  it('lists every file once', () => {
    const names = ledger.files.map((f) => f.file);
    expect(names.filter((n, i) => names.indexOf(n) !== i)).toEqual([]);
  });

  it('names only files that exist', () => {
    expect(ledger.files.filter((f) => !existsSync(resolve(ROOT, f.file))).map((f) => f.file)).toEqual([]);
  });

  it('covers every file whose header says it was ported from bp, and nothing else but the goldens', () => {
    const listed = ledger.files.filter((f) => f.kind !== 'golden').map((f) => f.file).sort();
    expect(listed).toEqual(portedFiles());
  });

  it("each port's header names the commit the ledger records", () => {
    const off = ledger.files
      .filter((f) => f.kind !== 'golden')
      .filter((f) => !new RegExp(`@ ${f.sha}\\b`).test(headOf(f.file)))
      .map((f) => `${f.file} (ledger @ ${f.sha})`);
    expect(off).toEqual([]);
  });
});
