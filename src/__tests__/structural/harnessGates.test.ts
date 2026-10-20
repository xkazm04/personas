import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import {
  BEGIN,
  MANIFEST,
  parseCapabilities,
  renderBlock,
  syncProjections,
} from '../../../.ai/project-commands.mjs';

/**
 * The harness gates are only worth trusting if they are seen to FAIL.
 *
 * `.ai/doctor.mjs` runs at pre-push and in the ai-conformance workflow, and
 * `syncProjections` (behind `guidanceCommands.test.ts`) keeps the generated
 * command tables honest. Both are otherwise only ever observed passing on the
 * real repo, which cannot tell a working gate from one that checks nothing.
 * Each case below hands a gate a known-bad repository and asserts the verdict,
 * next to a known-good control so a red case cannot be failing for an unrelated
 * reason. The repositories are written inline into temp directories: there is
 * no fixture corpus for another test to pick up.
 */
const REPO = resolve(__dirname, '../../..');
const DOCTOR = resolve(REPO, '.ai/doctor.mjs');
const REAL_MANIFEST = readFileSync(resolve(REPO, MANIFEST), 'utf8');

const made: string[] = [];
afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

/** A throwaway repository holding exactly `files` (path -> content). */
function repo(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'harness-gates-'));
  made.push(dir);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  return dir;
}

/** Run the doctor the way the hook does: from the repository root. */
function doctor(cwd: string): { status: number | null; out: string } {
  const r = spawnSync(process.execPath, [DOCTOR], { cwd, encoding: 'utf8', timeout: 30_000 });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

const GOOD_MANIFEST = [
  'schema: ai-manifest',
  'schemaVersion: 0.1.0',
  '',
  'capabilities:',
  '  test: { command: "npm test", verified: false }',
  '',
  'paths:',
  '  contextIndex: .ai/context-index.json',
  '  memory: .ai/memory/',
  '  evals: evals/',
  '',
].join('\n');

/** Everything the good manifest points at, so the control run is all-pass. */
const GOOD_TREE: Record<string, string> = {
  '.ai/manifest.yaml': GOOD_MANIFEST,
  '.ai/context-index.json': JSON.stringify({ modules: [{ id: 'root', path: '.', context: 'CONTEXT.md' }] }),
  '.ai/memory/README.md': 'memory\n',
  'evals/README.md': 'evals\n',
  'CONTEXT.md': '# root\n',
};

describe('.ai/doctor.mjs fails on a known-bad repository', () => {
  it('passes the known-good control (exit 0), so every red case below is red for its own reason', () => {
    const r = doctor(repo(GOOD_TREE));
    expect(r.out).toContain('declares 1 capabilities: test');
    expect(r.out).not.toContain('[FAIL]');
    expect(r.status).toBe(0);
  });

  it('fails when there is no manifest at all', () => {
    const r = doctor(repo({ 'README.md': 'nothing here\n' }));
    expect(r.out).toContain('missing .ai/manifest.yaml');
    expect(r.status).toBe(1);
  });

  it('fails a manifest that does not parse, instead of reading it as empty and passing', () => {
    const r = doctor(repo({ ...GOOD_TREE, '.ai/manifest.yaml': '{{{ not: [yaml\n\t- :::\n' }));
    expect(r.out).toContain('manifest schema id is not "ai-manifest"');
    expect(r.out).toContain('no capabilities declared');
    expect(r.status).toBe(1);
  });

  it('fails a well-formed manifest that declares no capabilities', () => {
    const manifest = GOOD_MANIFEST.replace('capabilities:\n  test: { command: "npm test", verified: false }\n', '');
    expect(manifest).not.toContain('capabilities:');
    const r = doctor(repo({ ...GOOD_TREE, '.ai/manifest.yaml': manifest }));
    expect(r.out).toContain('no capabilities declared');
    expect(r.status).toBe(1);
  });

  it('fails when the context index names a CONTEXT.md that does not exist', () => {
    const tree = { ...GOOD_TREE };
    delete tree['CONTEXT.md'];
    const r = doctor(repo(tree));
    expect(r.out).toContain('context-index references missing CONTEXT.md');
    expect(r.status).toBe(1);
  });

  it('fails when the context index does not parse, because then the context check read nothing', () => {
    const r = doctor(repo({ ...GOOD_TREE, '.ai/context-index.json': '{ "modules": [ ' }));
    expect(r.out).toContain('is not valid JSON');
    expect(r.status).toBe(1);
  });

  it('fails pre-push controls that no local hook runs, and passes once a hook runs them', () => {
    const manifest = `${GOOD_MANIFEST}controls:\n  prePush: [test]\n`;
    const unhooked = doctor(repo({ ...GOOD_TREE, '.ai/manifest.yaml': manifest }));
    expect(unhooked.out).toContain('prePush controls declared but NO local hook');
    expect(unhooked.status).toBe(1);

    const hooked = doctor(
      repo({ ...GOOD_TREE, '.ai/manifest.yaml': manifest, 'lefthook.yml': 'pre-push:\n  jobs:\n    - name: unit\n      run: npx vitest run\n' }),
    );
    expect(hooked.out).not.toContain('[FAIL]');
    expect(hooked.status).toBe(0);
  });

  it('reads a CRLF manifest the same as an LF one (it used to lose every capability)', () => {
    const r = doctor(repo({ ...GOOD_TREE, '.ai/manifest.yaml': GOOD_MANIFEST.replace(/\n/g, '\r\n') }));
    expect(r.out).toContain('declares 1 capabilities: test');
    expect(r.out).not.toContain('no capabilities declared');
    expect(r.status).toBe(0);
  });

  it('reads every capability of the real manifest when it is saved with CRLF', () => {
    const count = parseCapabilities(REAL_MANIFEST).length;
    expect(count).toBeGreaterThan(0);
    const r = doctor(repo({ '.ai/manifest.yaml': REAL_MANIFEST.replace(/\r?\n/g, '\r\n') }));
    expect(r.out).toContain(`declares ${count} capabilities`);
  });
});

describe('guidance projections fail when they drift from the manifest', () => {
  const current = renderBlock(REAL_MANIFEST);
  const projected = (block: string) => `# Guide\n\nintro\n\n${block}\n\noutro\n`;
  const statuses = (root: string) =>
    Object.fromEntries(syncProjections({ root }).map((r: { file: string; status: string }) => [r.file, r.status]));

  it('the control: both projections carrying the current block are ok', () => {
    const root = repo({ [MANIFEST]: REAL_MANIFEST, 'AGENTS.md': projected(current), 'CLAUDE.md': projected(current) });
    expect(statuses(root)).toEqual({ 'AGENTS.md': 'ok', 'CLAUDE.md': 'ok' });
  });

  it('reports a block rendered from an older manifest as stale', () => {
    const older = renderBlock(REAL_MANIFEST.replace('npx tsc --noEmit', 'npx tsc -p tsconfig.app.json --noEmit'));
    expect(older).not.toEqual(current);
    const root = repo({ [MANIFEST]: REAL_MANIFEST, 'AGENTS.md': projected(older), 'CLAUDE.md': projected(current) });
    expect(statuses(root)).toEqual({ 'AGENTS.md': 'stale', 'CLAUDE.md': 'ok' });
  });

  it('reports a projection with no markers, or only the opening marker, as missing rather than ok', () => {
    const root = repo({
      [MANIFEST]: REAL_MANIFEST,
      'AGENTS.md': '# Guide\n\nThe commands are somewhere else.\n',
      'CLAUDE.md': `# Guide\n\n${BEGIN}\n| test | \`npm test\` |\n`,
    });
    expect(statuses(root)).toEqual({ 'AGENTS.md': 'missing', 'CLAUDE.md': 'missing' });
  });

  it('accepts a current block saved with CRLF, and --write repairs a stale one in place', () => {
    const older = renderBlock(REAL_MANIFEST.replace('npm run lint', 'npm run lint:all'));
    const root = repo({
      [MANIFEST]: REAL_MANIFEST,
      'AGENTS.md': projected(current).replace(/\n/g, '\r\n'),
      'CLAUDE.md': projected(older).replace(/\n/g, '\r\n'),
    });
    expect(statuses(root)).toEqual({ 'AGENTS.md': 'ok', 'CLAUDE.md': 'stale' });

    const written = syncProjections({ root, write: true }).map((r: { status: string }) => r.status);
    expect(written).toEqual(['ok', 'written']);
    expect(statuses(root)).toEqual({ 'AGENTS.md': 'ok', 'CLAUDE.md': 'ok' });
    const repaired = readFileSync(join(root, 'CLAUDE.md'), 'utf8');
    expect(repaired).toContain('\r\n');
    expect(repaired).not.toMatch(/[^\r]\n/);
    expect(repaired).toContain('outro');
  });
});
