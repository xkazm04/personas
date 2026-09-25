/**
 * THE PAGE BEFORE THE INSTRUMENT HAS RUN.
 *
 * The page's whole argument is that an unknown is not a zero, so the state a
 * first-time reader meets is the one place it can least afford to be wrong. A
 * skeleton that drew `0` in every slot would type-check, lint clean, screenshot
 * plausibly and tell the page's own central lie on first contact. Nothing but
 * an assertion tells that apart from this.
 *
 * What is asserted here: the full layout draws, every figure position wears the
 * UNKNOWN ink, no figure anywhere reads `0`, the three unpopulated phases say
 * three different things, exactly one run control exists in each of them, and a
 * real plan still draws the populated ledger it always did.
 */
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';

import en from '@/i18n/locales/en.json';
import { interpolate } from '@/i18n/useTranslation';
import type { CuratorPolicy } from '@/lib/bindings/CuratorPolicy';

import { Blueprint } from '../Blueprint';
import { CuratorConsole } from '../console/CuratorConsole';
import type { CuratorLoop } from '../console/useCuratorLoop';
import type { BlueprintPhase } from '../ledger/LedgerEmpty';
import { buildModel } from '../model/buildModel';
import { EMPTY_DOCKET } from '../model/docket';
import type { BlueprintModel } from '../model/types';
import { unmeasuredModel } from '../model/unmeasured';
import type { BlueprintStrings, BlueprintWords } from '../words';

import { plan } from './fixture';

// The English catalog is the generated type's own source, so this names the
// invariant rather than hiding a shape mismatch: `types.ts` is codegen'd from
// exactly this file.
const words: BlueprintWords = {
  w: en.companions.blueprint as unknown as BlueprintStrings,
  tx: interpolate,
};
const W = en.companions.blueprint;

const loop: CuratorLoop = {
  requests: null,
  skills: null,
  runtime: null,
  loading: false,
  file: () => Promise.resolve(),
  cancel: () => Promise.resolve(),
  reload: () => Promise.resolve(),
};

function operatorConsole(refreshing: boolean): ReactNode {
  return (
    <CuratorConsole
      loop={loop}
      policy={null}
      refreshing={refreshing}
      onRefresh={() => Promise.resolve()}
    />
  );
}

function draw(model: BlueprintModel, phase: BlueprintPhase = 'unrun') {
  return render(
    <Blueprint
      model={model}
      docket={EMPTY_DOCKET}
      words={words}
      phase={phase}
      console={operatorConsole(phase === 'running')}
    />,
  );
}

describe('the unpopulated page is the real page, drawn empty', () => {
  it('draws the whole layout: verdict, nine channel heads, both bands, the foot', () => {
    const { container } = draw(unmeasuredModel());
    expect(container.querySelector('.cb-verdict')).not.toBeNull();
    expect(container.querySelectorAll('[data-role="cb-channel-head"]')).toHaveLength(9);
    // Both aggregate bands, in their unpopulated form: the unlisted band and
    // the quiet tail. Neither is hidden behind a count nobody has taken.
    expect(container.querySelectorAll('[data-role="cb-band-row"]')).toHaveLength(2);
    expect(container.querySelector('.cb-foot')).not.toBeNull();
    expect(container.querySelector('[data-role="cb-docket"]')).not.toBeNull();
    // Said once, where the rows would be, not as a card that replaced them.
    expect(container.querySelectorAll('[data-role="cb-ledger-empty"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-cb-row]')).toHaveLength(0);
  });

  it('wears the ledger own unknown ink where every figure would be', () => {
    const { container } = draw(unmeasuredModel());
    const marks = [...container.querySelectorAll('[data-role="cb-unmeasured"]')];
    expect(marks.length).toBeGreaterThan(10);
    for (const mark of marks) {
      expect(mark.querySelector('.cb-unkbox')).not.toBeNull();
      // Announced, not decorative: a hatched box read out as nothing is
      // indistinguishable from a zero to anyone who cannot see it.
      expect(mark.getAttribute('aria-label')).toBe(W.not_measured);
      expect(mark.textContent).toBe('');
    }
    // The hero slot the whole page is built around is one of them.
    const hero = container.querySelector('[data-role="cb-verdict-figure"]');
    expect(hero?.querySelector('[data-role="cb-unmeasured"]')).not.toBeNull();
  });

  it('renders NO figure as 0 anywhere the corpus is described', () => {
    const { container } = draw(unmeasuredModel());
    // The verdict strip, the ledger (head + empty line + both bands) and the
    // foot's gauges: every region that would carry a measured quantity. The
    // docket's own counter is excluded on purpose - its feed is empty by
    // construction, so its 0 is a measured zero and the drawer says so.
    for (const selector of ['.cb-verdict', '.cb-lscroll', '.cb-foot']) {
      const region = container.querySelector(selector);
      expect(region, selector).not.toBeNull();
      const numbers = (region?.textContent ?? '').split(/[^\p{Nd}.,%]+/u).filter(Boolean);
      expect(numbers.filter((d) => /^0([.,]0+)?%?$/.test(d)), selector).toEqual([]);
    }
  });

  it('keeps the three phases distinct and never offers the run twice', () => {
    const said = new Map<BlueprintPhase, string>();
    for (const phase of ['reading', 'running', 'unrun'] as const) {
      const { container, unmount } = draw(unmeasuredModel(), phase);
      const line = container.querySelector('[data-role="cb-ledger-empty"]');
      expect(line?.getAttribute('data-phase')).toBe(phase);
      said.set(phase, line?.textContent ?? '');
      // ONE run control, in every phase, and always the console's.
      const controls = container.querySelectorAll('[data-testid="curator-run-instrument"]');
      expect(controls, phase).toHaveLength(1);
      expect(container.querySelector('[data-role="cb-console"]')?.contains(controls[0]!)).toBe(true);
      unmount();
    }
    expect(new Set(said.values()).size).toBe(3);
    expect(said.get('reading')).toContain(W.boot_title);
    expect(said.get('running')).toContain(W.console.refresh_title);
    expect(said.get('unrun')).toContain(W.no_plan_title);
    // The one phase that is an offer never reads as a read in flight.
    expect(said.get('unrun')).not.toContain(W.boot_title);
  });
});

describe('a measured plan still draws the populated ledger', () => {
  it('renders its rows, its counts and no empty line', () => {
    const model = buildModel(plan());
    const { container } = draw(model);
    expect(container.querySelectorAll('[data-role="cb-ledger-empty"]')).toHaveLength(0);
    expect(container.querySelectorAll('[data-cb-row]')).toHaveLength(model.rows?.length ?? 0);
    expect(container.querySelectorAll('[data-role="cb-unmeasured"]')).toHaveLength(0);
    const counts = [...container.querySelectorAll('[data-role="cb-channel-count"]')];
    expect(counts).toHaveLength(9);
    expect(counts.every((c) => /^\d/.test(c.textContent ?? ''))).toBe(true);
  });
});

describe('the unmeasured model carries no zero at all', () => {
  it('leaves every quantity null, and only the two drawing scales numeric', () => {
    const model = unmeasuredModel();
    const numeric: string[] = [];
    const walk = (value: unknown, path: string) => {
      if (typeof value === 'number') {
        numeric.push(path);
      } else if (Array.isArray(value)) {
        value.forEach((v, i) => {
          walk(v, path + '[' + String(i) + ']');
        });
      } else if (value && typeof value === 'object') {
        for (const [k, v] of Object.entries(value)) walk(v, path ? path + '.' + k : k);
      }
    };
    walk(model, '');
    // The nine channel ids are the channels' own names, not measurements.
    expect(numeric.filter((p) => !/^totals\.\d+\.channel$/.test(p)).sort()).toEqual([
      'maxCeiling',
      'maxPoints',
    ]);
    expect(model.rows).toBeNull();
    expect(model.quiet).toBeNull();
    expect(model.consumers.projects).toBeNull();
    expect(model.policy).toBeNull();
  });

  it('draws the live policy when that door answered, since the plan is not its source', () => {
    // `curator_policy_get` has its own door and answers before any projection
    // exists, so the foot's gauges are real here while everything else is not.
    const live: CuratorPolicy = {
      backpressureN: 3,
      workerCap: 2,
      dailyBudgetUsd: null,
      dailyRunCap: null,
      dailyCommitCap: null,
      quietHours: null,
      levelResearch: 'notify',
      levelForge: 'notify',
      levelConform: 'notify',
      levelSweep: 'notify',
    } as CuratorPolicy;
    const model = unmeasuredModel({ policy: live });
    expect(model.policy?.backpressureN).toBe(3);
    expect(model.livePolicy?.workerCap).toBe(2);
    // There is no agreed-to policy to disagree with until a plan carries one.
    expect(model.policyDrift).toEqual([]);
  });
});
