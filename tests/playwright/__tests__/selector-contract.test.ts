import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * The test-identifier contract between the live-app harness and the product.
 *
 * The Playwright specs in `tests/playwright/` locate elements by `data-testid`
 * and run only against a live `tauri:dev:test` app, so no CI lane runs them and
 * `tsc` does not include them. A product change that renames or removes a
 * testid therefore breaks a spec silently: measured 2026-10-19, 4 specs carried
 * 11 identifiers that no product file has emitted for 1 to 5 months (fleet
 * subtabs removed 2026-05-17, the team Orchestrate console retired 2026-07-13,
 * the capability Run Now removed 2026-09-04, the twin Fields switch fused away
 * 2026-09-24).
 *
 * This test reads every spec/helper, extracts each literal testid it queries or
 * clicks, and requires the product (`src/`, test files excluded) to emit it -
 * either as a literal or through a template whose prefix matches and whose
 * remaining suffix is itself a literal id (`tab-${item.id}` + `'fleet'`).
 *
 * KNOWN is two-sided: an unknown missing id fails, and a KNOWN entry that
 * resolves again fails too, so the list can only shrink deliberately.
 */

const ROOT = path.resolve(__dirname, '../../..');
const SPEC_DIR = path.join(ROOT, 'tests', 'playwright');
const SRC_DIR = path.join(ROOT, 'src');

type Reason = 'absent-by-design' | 'data-driven' | 'drift';

/** `<spec file>:<testid>` -> why it does not resolve statically. */
const KNOWN: Record<string, Reason> = {
  // The spec asserts these are GONE (count === 0); absence is the contract.
  'twin-cycle-features.spec.ts:setup-variant-switcher': 'absent-by-design',
  'twin-cycle-features.spec.ts:setup-fields-drawer': 'absent-by-design',
  // Built from runtime data (credential field keys, template question ids).
  'discord-twin-1-setup.spec.ts:vault-field-bot_token-input': 'data-driven',
  'preset-questionnaire.spec.ts:preset-question-aq_coach_tone': 'data-driven',
  'preset-questionnaire.spec.ts:preset-question-aq_pattern_lookback_weeks': 'data-driven',
  // Real drift: the product no longer emits these. Each needs a live-app run
  // to repoint; remove the entry in the same change that fixes the spec.
  'fleet-smoke.spec.ts:fleet-subtab-settings': 'drift',
  'fleet-smoke.spec.ts:fleet-subtab-grid': 'drift',
  'fleet-smoke.spec.ts:fleet-subtab-decisions': 'drift',
  'fleet-smoke.spec.ts:fleet-spawn-flyout': 'drift',
  'fleet-smoke.spec.ts:fleet-spawn-toggle': 'drift',
  'fleet-smoke.spec.ts:fleet-decisions-page': 'drift',
  'fleet-smoke.spec.ts:fleet-decision-text': 'drift',
  'getting-started-tour.spec.ts:capability-run-now': 'drift',
  'team-functionality.spec.ts:team-mode-orchestrate': 'drift',
  'team-functionality.spec.ts:team-mode-board': 'drift',
  'team-functionality.spec.ts:team-goal-input': 'drift',
  'team-functionality.spec.ts:team-preview-button': 'drift',
  'team-functionality.spec.ts:team-assign-button': 'drift',
  'team-functionality.spec.ts:team-assignment-board': 'drift',
  'twin-cycle-features.spec.ts:setup-open-fields': 'drift',
};

/** Drop block and line comments so an id named in prose proves nothing. */
function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
}

function readProductCorpus(): string {
  const parts: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === '__tests__' || e.name === 'test' || e.name === 'bindings' || e.name === 'node_modules') continue;
        walk(p);
      } else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) {
        parts.push(stripComments(fs.readFileSync(p, 'utf8')));
      }
    }
  };
  walk(SRC_DIR);
  return parts.join('\n');
}

/** Literal testids a harness file queries, clicks or fills; `prefix` marks `^=` selectors. */
export function extractTestIds(source: string): Map<string, { prefix: boolean }> {
  const ids = new Map<string, { prefix: boolean }>();
  const re = /data-testid(\^?)=\\?["']([A-Za-z0-9_-]+)["'\\]|[a-zA-Z]*TestId\(\s*['"]([A-Za-z0-9_-]+)['"]|fillField\(\s*['"]([A-Za-z0-9_-]+)['"]/g;
  const text = stripComments(source);
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const id = (m[2] ?? m[3] ?? m[4])!;
    const prefix = m[1] === '^';
    const prev = ids.get(id);
    ids.set(id, { prefix: prefix && (prev ? prev.prefix : true) });
  }
  return ids;
}

export function makeResolver(corpus: string) {
  const quoted = (s: string) => corpus.includes(`'${s}'`) || corpus.includes(`"${s}"`) || corpus.includes('`' + s + '`');
  return (id: string, prefix: boolean): boolean => {
    if (prefix) {
      if (corpus.includes(id)) return true;
      for (let i = id.indexOf('-'); i > 0; i = id.indexOf('-', i + 1)) {
        if (corpus.includes('`' + id.slice(0, i + 1) + '${')) return true;
      }
      return false;
    }
    if (quoted(id)) return true;
    for (let i = id.indexOf('-'); i > 0; i = id.indexOf('-', i + 1)) {
      const head = id.slice(0, i + 1);
      const tail = id.slice(i + 1);
      if (corpus.includes('`' + head + '${') && (quoted(tail) || /^\d+$/.test(tail))) return true;
    }
    return false;
  };
}

describe('playwright selector contract', () => {
  it('the resolver accepts literal and template ids and rejects a missing one', () => {
    const resolve = makeResolver("x data-testid=\"companion-close\" y `tab-${item.id}` z { id: 'fleet' } `row-${n}`");
    expect(resolve('companion-close', false)).toBe(true);
    expect(resolve('tab-fleet', false)).toBe(true);
    expect(resolve('row-4', false)).toBe(true);
    expect(resolve('tab-nowhere', false)).toBe(false);
    expect(resolve('companion-gone', false)).toBe(false);
    expect(resolve('row-', true)).toBe(true);
  });

  it('extraction ignores ids that only appear in comments', () => {
    const ids = extractTestIds("// clickTestId('in-a-comment')\nawait app.clickTestId('real-one');\nquery('[data-testid^=\"pre-\"]')");
    expect([...ids.keys()].sort()).toEqual(['pre-', 'real-one']);
    expect(ids.get('pre-')!.prefix).toBe(true);
  });

  it('every testid a harness file uses is emitted by the product, or is a KNOWN entry', () => {
    const resolve = makeResolver(readProductCorpus());
    const unresolved = new Set<string>();
    let total = 0;
    for (const f of fs.readdirSync(SPEC_DIR).filter((n) => n.endsWith('.ts'))) {
      for (const [id, { prefix }] of extractTestIds(fs.readFileSync(path.join(SPEC_DIR, f), 'utf8'))) {
        total += 1;
        if (!resolve(id, prefix)) unresolved.add(`${f}:${id}`);
      }
    }
    // Guard against a broken extractor reporting a clean result over nothing.
    expect(total).toBeGreaterThan(100);

    const newDrift = [...unresolved].filter((k) => !(k in KNOWN)).sort();
    const stale = Object.keys(KNOWN).filter((k) => !unresolved.has(k)).sort();
    expect(newDrift, 'spec testids no product file emits (fix the spec with the product change)').toEqual([]);
    expect(stale, 'KNOWN entries that resolve now or whose spec dropped them: delete them').toEqual([]);
  });
});
