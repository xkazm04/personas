// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import yaml from 'js-yaml';
import { describe, expect, it } from 'vitest';

/**
 * THE TOOLCHAIN PIN (the note on `rust-fmt` in ci.yml) is copied into every
 * Rust job, in five workflows. Each copy has three steps: read the channel out
 * of `rust-toolchain.toml` with sed and fail on empty, hand it to
 * `dtolnay/rust-toolchain@master`, then assert that `rustup` really activated
 * it. A fix made to one copy and missed in the others is the failure this test
 * exists for: every copy must equal the first one, so a change to any copy
 * fails here until all of them carry it.
 *
 * The structural fix is a composite action under `.github/actions/` that every
 * job calls once. That edits the existing workflows, which is a human's step.
 * Until then this test is what keeps the copies from drifting. When the
 * composite action lands, the copies become one, and this test should be
 * rewritten to assert that no job inlines the block any more.
 *
 * It also proves the shared sed expression still reads the real
 * `rust-toolchain.toml`, so a reformatted pin file fails here and not in the
 * first Rust job of the next push.
 *
 * THE INSTRUMENT IS ASSERTED BEFORE THE RESULT: a walk that found no copies
 * would otherwise report them all identical.
 */
const REPO = resolve(__dirname, '../../..');
const WORKFLOW_DIR = resolve(REPO, '.github/workflows');

// Measured 2026-10-10: 11 copies across ci.yml (5), installer-test.yml (3),
// audit.yml, e2e-smoke.yml and release.yml. The floor sits below that so a
// removed job does not trip it, but a broken walk does.
const MIN_COPIES = 8;

const READ_STEP_ID = 'rust-pin';
const ASSERT_STEP_NAME = 'Assert the active toolchain is the pinned one';
const TOOLCHAIN_INPUT = '${{ steps.rust-pin.outputs.channel }}';

type Doc = Record<string, unknown>;

function asMap(value: unknown): Doc | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Doc) : undefined;
}

/** A step's shell body with comment-only and blank lines dropped: comments may differ, code may not. */
function codeOf(run: unknown): string {
  return String(run ?? '')
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim() !== '' && !line.trim().startsWith('#'))
    .join('\n');
}

interface PinCopy {
  where: string;
  toolchainRef: string;
  toolchainInput: unknown;
  read: string | null;
  assert: string | null;
}

/** Every `dtolnay/rust-toolchain` step in a workflow, with the read step before it and the assert step after it. */
function pinCopies(file: string, doc: Doc): PinCopy[] {
  const copies: PinCopy[] = [];
  for (const [jobName, jobValue] of Object.entries(asMap(doc.jobs) ?? {})) {
    const steps = (Array.isArray(asMap(jobValue)?.steps) ? (asMap(jobValue)?.steps as unknown[]) : []).map((s) => asMap(s) ?? {});
    steps.forEach((step, index) => {
      const uses = typeof step.uses === 'string' ? step.uses : '';
      if (!uses.startsWith('dtolnay/rust-toolchain@')) return;
      const read = steps.slice(0, index).reverse().find((s) => s.id === READ_STEP_ID);
      const assert = steps.slice(index + 1).find((s) => s.name === ASSERT_STEP_NAME);
      copies.push({
        where: `${file} > ${jobName}`,
        toolchainRef: uses.slice(uses.indexOf('@') + 1),
        toolchainInput: asMap(step.with)?.toolchain,
        read: read ? codeOf(read.run) : null,
        assert: assert ? codeOf(assert.run) : null,
      });
    });
  }
  return copies;
}

/** The sed `s/<pattern>/\1/p` expression in the read step, as a JS RegExp. */
function sedPatternOf(readCode: string): RegExp | null {
  const match = /sed -nE 's\/(.+?)\/\\1\/p'/.exec(readCode);
  if (!match) return null;
  return new RegExp(match[1].replace(/\[\[:space:\]\]/g, '\\s'), 'm');
}

describe('rust toolchain pin', () => {
  const files = readdirSync(WORKFLOW_DIR).filter((f) => /\.ya?ml$/.test(f)).sort();
  const copies = files.flatMap((file) => {
    const doc = asMap(yaml.load(readFileSync(resolve(WORKFLOW_DIR, file), 'utf8')));
    return doc ? pinCopies(file, doc) : [];
  });

  it('actually found the copies (instrument before result)', () => {
    expect(copies.length, `found ${copies.length} dtolnay/rust-toolchain step(s); the walk is broken, not the pin consolidated`).toBeGreaterThanOrEqual(MIN_COPIES);
  });

  it('every copy is the whole guard: read, install the read channel, assert', () => {
    // `@stable` and friends ignore rust-toolchain.toml and install whatever stable is that day.
    expect(copies.filter((c) => c.toolchainRef !== 'master').map((c) => `${c.where}: @${c.toolchainRef}`)).toEqual([]);
    expect(copies.filter((c) => c.toolchainInput !== TOOLCHAIN_INPUT).map((c) => c.where), `toolchain: must be ${TOOLCHAIN_INPUT}`).toEqual([]);
    expect(copies.filter((c) => c.read === null).map((c) => c.where), `no earlier step with id: ${READ_STEP_ID}`).toEqual([]);
    expect(copies.filter((c) => c.assert === null).map((c) => c.where), `no later step named "${ASSERT_STEP_NAME}"`).toEqual([]);
  });

  it('every copy carries the same code as the first one', () => {
    const canonical = copies[0];
    expect(canonical, 'no copies to compare').toBeDefined();
    expect(
      copies.filter((c) => c.read !== canonical?.read).map((c) => c.where),
      `the channel-read step differs from ${canonical?.where}: apply the same change to every copy`,
    ).toEqual([]);
    expect(
      copies.filter((c) => c.assert !== canonical?.assert).map((c) => c.where),
      `the assert step differs from ${canonical?.where}: apply the same change to every copy`,
    ).toEqual([]);
  });

  it('the shared sed expression reads the real rust-toolchain.toml', () => {
    const pattern = sedPatternOf(copies[0]?.read ?? '');
    expect(pattern, 'the read step no longer uses `sed -nE \'s/<pattern>/\\1/p\'`; update sedPatternOf with it').not.toBeNull();
    const channel = pattern?.exec(readFileSync(resolve(REPO, 'rust-toolchain.toml'), 'utf8'))?.[1] ?? '';
    expect(channel, 'every Rust job would fail at "has no readable channel"').not.toBe('');
  });

  it('the instruments discriminate (each fails on the shape it exists to catch)', () => {
    const read = '      CHANNEL=$(sed -nE \'s/x/y/p\')\n      # why\n\n      echo "channel=$CHANNEL"\n';
    expect(codeOf(read)).toBe('      CHANNEL=$(sed -nE \'s/x/y/p\')\n      echo "channel=$CHANNEL"');
    expect(codeOf(read)).not.toBe(codeOf(read.replace('channel=', 'chanel=')));

    const workflow = asMap(
      yaml.load(
        [
          'jobs:',
          '  good:',
          '    steps:',
          '      - id: rust-pin',
          '        run: echo read',
          '      - uses: dtolnay/rust-toolchain@master',
          '        with:',
          `          toolchain: ${TOOLCHAIN_INPUT}`,
          '      - run: echo between',
          `      - name: ${ASSERT_STEP_NAME}`,
          '        run: echo assert',
          '  bare:',
          '    steps:',
          '      - uses: dtolnay/rust-toolchain@stable',
        ].join('\n'),
      ),
    ) as Doc;
    expect(pinCopies('w.yml', workflow)).toEqual([
      { where: 'w.yml > good', toolchainRef: 'master', toolchainInput: TOOLCHAIN_INPUT, read: 'echo read', assert: 'echo assert' },
      { where: 'w.yml > bare', toolchainRef: 'stable', toolchainInput: undefined, read: null, assert: null },
    ]);

    const sed = sedPatternOf(
      'CHANNEL=$(sed -nE \'s/^[[:space:]]*channel[[:space:]]*=[[:space:]]*"([^"]+)".*/\\1/p\' rust-toolchain.toml | head -n 1)',
    );
    expect(sed?.exec('[toolchain]\nchannel = "1.90.0"\n')?.[1]).toBe('1.90.0');
    expect(sed?.exec('[toolchain]\nversion = "1.90.0"\n')).toBeNull();
  });
});
