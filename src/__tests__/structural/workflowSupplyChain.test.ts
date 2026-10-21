import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import yaml from 'js-yaml';
import { describe, expect, it } from 'vitest';

/**
 * Supply-chain posture of `.github/workflows/`, held as a two-sided ratchet.
 *
 * Two conditions are owed a fix that lives in the workflows themselves (a
 * least-privilege `permissions:` block in every workflow, and every action
 * pinned to a 40-character commit SHA, which Renovate's
 * `helpers:pinGitHubActionDigests` in `renovate.json` will do once the
 * Renovate App runs). Until then this test stops both from getting WORSE:
 *
 *   - a NEW workflow that declares no token scope fails;
 *   - a NEW top-level `write` grant (or `write-all`) fails;
 *   - a NEW third-party action referenced by a mutable tag or branch fails.
 *
 * Every allowlist is two-sided, like `scripts/binding-orphan-allowlist.txt`:
 * an entry that stops being a violation fails too, with "delete this entry",
 * so the list only ever shrinks and never hides a fixed condition.
 *
 * Why a test and not the other two homes:
 *   - The census cannot ratchet the pin condition: its positive control would
 *     match zero compliant references (supply-chain-policy.md §9, which also
 *     specified this checker, floor assertion included).
 *   - `.ai/doctor.mjs` has no allowlist, so a doctor `fail` would turn the
 *     ai-conformance merge gate red on the existing workflows, and a `warn`
 *     enforces nothing.
 *
 * THE INSTRUMENT IS ASSERTED BEFORE THE RESULT: a glob that finds no workflows
 * would otherwise report perfect scoping and perfect pinning.
 */
const REPO = resolve(__dirname, '../../..');
const WORKFLOW_DIR = resolve(REPO, '.github/workflows');

// Measured 2026-10-09: 7 workflows, 72 `uses:` references. Floors sit below
// both so an added or removed step does not trip them, but a broken walk does.
const MIN_WORKFLOWS = 7;
const MIN_ACTION_REFS = 60;

/** Workflows with neither a top-level `permissions:` nor one on every job. */
const IMPLICIT_SCOPE_ALLOWLIST: Record<string, string> = {
  'ai-conformance.yml':
    'one job (checkout + setup-node + doctor) runs on the default token; owed `permissions: contents: read` at the top',
  'audit.yml':
    'scheduled audit runs on the default token; owed `permissions: contents: read` at the top',
  'ci.yml':
    'only `changes` and `frontend-checks` declare a scope; owed `permissions: contents: read` at the top, keeping the two job-level grants',
  'e2e-smoke.yml':
    'PR-only smoke job runs on the default token; owed `permissions: contents: read` at the top',
};

/** Top-level `<scope>: write` grants, keyed `<file>:<scope>`. `write-all` is never allowed. */
const TOP_LEVEL_WRITE_ALLOWLIST: Record<string, string> = {
  'release.yml:contents':
    'owed narrowing: top level becomes `contents: read`; only `version`, `build` and `updater-manifest` need `contents: write` (and `build` `id-token: write` + `attestations: write` for provenance). Today the `frontend` job (npm ci + build) holds a token that can push master and tags',
};

/**
 * Third-party actions still referenced by a mutable ref somewhere. Keyed by
 * identity (`owner/repo[/path]`, lower-cased), not by ref, so a version bump
 * of an action already listed passes and only a NEW unpinned action fails.
 */
const UNPINNED_ACTION_ALLOWLIST: Record<string, string> = {
  'actions/checkout': 'first-party; awaiting the Renovate pin PR',
  'actions/setup-node': 'first-party; awaiting the Renovate pin PR',
  'actions/upload-artifact': 'first-party; awaiting the Renovate pin PR',
  'actions/download-artifact': 'first-party; awaiting the Renovate pin PR (release.yml build job, contents: write)',
  'github/codeql-action/init': 'first-party; awaiting the Renovate pin PR',
  'github/codeql-action/analyze': 'first-party; awaiting the Renovate pin PR',
  'dtolnay/rust-toolchain':
    'third-party, referenced by BRANCH (@master), so its code changes with every push upstream; runs in release.yml build beside TAURI_SIGNING_PRIVATE_KEY',
  'mozilla-actions/sccache-action':
    'third-party 0.x (@v0.0.7): Renovate will not automerge its pin, a human must merge it; runs in release.yml build',
  'swatinem/rust-cache': 'third-party; awaiting the Renovate pin PR; runs in release.yml build',
  'tauri-apps/tauri-action':
    'third-party 0.x (@v0): Renovate will not automerge its pin, a human must merge it; it builds and signs the installers',
};

type Doc = Record<string, unknown>;

/** Narrow a parsed YAML node to a mapping; anything else is "absent". */
function asMap(value: unknown): Doc | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Doc) : undefined;
}

function parseWorkflow(text: string): Doc {
  const doc = asMap(yaml.load(text));
  if (!doc) throw new Error('workflow did not parse to a mapping');
  return doc;
}

function jobsOf(doc: Doc): [string, Doc][] {
  return Object.entries(asMap(doc.jobs) ?? {}).map(([name, job]) => [name, asMap(job) ?? {}]);
}

/** A workflow is scoped if it declares `permissions:` at the top, or on every job. */
function hasExplicitScope(doc: Doc): boolean {
  if ('permissions' in doc) return true;
  const jobs = jobsOf(doc);
  return jobs.length > 0 && jobs.every(([, job]) => 'permissions' in job);
}

/** Top-level write grants as scope names; `write-all` reports as `*`. */
function topLevelWriteGrants(doc: Doc): string[] {
  const perms = doc.permissions;
  if (perms === 'write-all') return ['*'];
  return Object.entries(asMap(perms) ?? {})
    .filter(([, level]) => level === 'write')
    .map(([scope]) => scope);
}

interface ActionRef {
  identity: string;
  pinned: boolean;
  local: boolean;
}

/** Classify one `uses:` value. */
function classifyUses(uses: string): ActionRef {
  const value = uses.trim();
  // A local action is versioned by this repository's own commit.
  if (value.startsWith('./')) return { identity: value, pinned: true, local: true };
  if (value.startsWith('docker://')) {
    const image = value.slice('docker://'.length);
    const repo = (image.split(/[@:]/)[0] ?? image).toLowerCase();
    return { identity: `docker://${repo}`, pinned: /@sha256:[0-9a-f]{64}$/.test(image), local: false };
  }
  const at = value.lastIndexOf('@');
  const name = at === -1 ? value : value.slice(0, at);
  const ref = at === -1 ? '' : value.slice(at + 1);
  return { identity: name.toLowerCase(), pinned: /^[0-9a-f]{40}$/.test(ref), local: false };
}

/** Every `uses:` value in a workflow: reusable-workflow jobs and steps. */
function usesOf(doc: Doc): string[] {
  const out: string[] = [];
  for (const [, job] of jobsOf(doc)) {
    if (typeof job.uses === 'string') out.push(job.uses);
    for (const step of Array.isArray(job.steps) ? job.steps : []) {
      const uses = asMap(step)?.uses;
      if (typeof uses === 'string') out.push(uses);
    }
  }
  return out;
}

function staleEntries(allowlist: Record<string, string>, stillViolating: Set<string>): string[] {
  return Object.keys(allowlist).filter((key) => !stillViolating.has(key));
}

describe('workflow supply-chain posture', () => {
  const files = readdirSync(WORKFLOW_DIR).filter((f) => /\.ya?ml$/.test(f)).sort();
  const workflows = files.map((file) => ({
    file,
    doc: parseWorkflow(readFileSync(resolve(WORKFLOW_DIR, file), 'utf8')),
  }));
  const refs = workflows.flatMap(({ file, doc }) => usesOf(doc).map((uses) => ({ file, uses, ...classifyUses(uses) })));

  it('actually read the workflows (instrument before result)', () => {
    expect(files.length, `found ${files.length} workflow(s) in .github/workflows; the walk is broken, not the posture clean`).toBeGreaterThanOrEqual(MIN_WORKFLOWS);
    expect(refs.length, `found ${refs.length} uses: reference(s); the parser is broken, not the workflows pinned`).toBeGreaterThanOrEqual(MIN_ACTION_REFS);
  });

  it('every workflow declares a token scope, or is allowlisted as owing one', () => {
    const implicit = new Set(workflows.filter(({ doc }) => !hasExplicitScope(doc)).map(({ file }) => file));
    expect(
      [...implicit].filter((file) => !(file in IMPLICIT_SCOPE_ALLOWLIST)),
      'a workflow without `permissions:` runs on the repository default token: add a top-level `permissions: contents: read` and grant write per job',
    ).toEqual([]);
    expect(
      staleEntries(IMPLICIT_SCOPE_ALLOWLIST, implicit),
      'these workflows now declare a scope: delete their IMPLICIT_SCOPE_ALLOWLIST entry',
    ).toEqual([]);
  });

  it('no workflow grants write at the top level beyond the allowlist', () => {
    const grants = new Set(workflows.flatMap(({ file, doc }) => topLevelWriteGrants(doc).map((scope) => `${file}:${scope}`)));
    expect(
      [...grants].filter((key) => !(key in TOP_LEVEL_WRITE_ALLOWLIST)),
      'a top-level write grant reaches every job and every action in the workflow: move it onto the one job that needs it',
    ).toEqual([]);
    expect(
      staleEntries(TOP_LEVEL_WRITE_ALLOWLIST, grants),
      'these top-level write grants are gone: delete their TOP_LEVEL_WRITE_ALLOWLIST entry',
    ).toEqual([]);
  });

  it('no new action is referenced by a mutable tag or branch', () => {
    const unpinned = new Set(refs.filter((r) => !r.pinned && !r.local).map((r) => r.identity));
    const added = refs.filter((r) => !r.pinned && !r.local && !(r.identity in UNPINNED_ACTION_ALLOWLIST));
    expect(
      added.map((r) => `${r.file}: ${r.uses}`),
      'pin new actions to a full commit SHA (`owner/repo@<40-hex> # vN`): a tag can be moved under this pipeline',
    ).toEqual([]);
    expect(
      staleEntries(UNPINNED_ACTION_ALLOWLIST, unpinned),
      'these actions are now SHA-pinned everywhere: delete their UNPINNED_ACTION_ALLOWLIST entry',
    ).toEqual([]);
  });

  it('the classifiers discriminate (each fails on the shape it exists to catch)', () => {
    const scoped = parseWorkflow('permissions:\n  contents: read\njobs:\n  a:\n    runs-on: x\n');
    const perJob = parseWorkflow('jobs:\n  a:\n    permissions: {}\n  b:\n    permissions:\n      contents: read\n');
    const partial = parseWorkflow('jobs:\n  a:\n    permissions: {}\n  b:\n    runs-on: x\n');
    const bare = parseWorkflow('on: push\njobs:\n  a:\n    runs-on: x\n');
    expect([scoped, perJob, partial, bare].map(hasExplicitScope)).toEqual([true, true, false, false]);

    expect(topLevelWriteGrants(parseWorkflow('permissions: write-all\n'))).toEqual(['*']);
    expect(topLevelWriteGrants(parseWorkflow('permissions:\n  contents: write\n  packages: read\n'))).toEqual(['contents']);
    expect(topLevelWriteGrants(parseWorkflow('permissions: read-all\n'))).toEqual([]);

    expect(classifyUses('actions/checkout@v4')).toEqual({ identity: 'actions/checkout', pinned: false, local: false });
    expect(classifyUses('Swatinem/rust-cache@v2').identity).toBe('swatinem/rust-cache');
    expect(classifyUses('actions/checkout@0123456789abcdef0123456789abcdef01234567').pinned).toBe(true);
    // A 40-character ref that is not hex is a branch name, not a SHA.
    expect(classifyUses('actions/checkout@0123456789abcdef0123456789abcdef0123456z').pinned).toBe(false);
    expect(classifyUses('github/codeql-action/init@v3').identity).toBe('github/codeql-action/init');
    expect(classifyUses('./.github/actions/setup').local).toBe(true);
    expect(classifyUses('docker://alpine:3.20').pinned).toBe(false);
    expect(classifyUses(`docker://alpine@sha256:${'a'.repeat(64)}`).pinned).toBe(true);

    expect(usesOf(parseWorkflow('jobs:\n  a:\n    uses: org/repo/.github/workflows/x.yml@v1\n  b:\n    steps:\n      - uses: actions/checkout@v4\n      - run: echo\n'))).toEqual([
      'org/repo/.github/workflows/x.yml@v1',
      'actions/checkout@v4',
    ]);
  });
});
