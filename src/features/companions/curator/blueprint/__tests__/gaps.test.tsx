/**
 * THREE DRAWERS, ONE SURFACE - and the absences the Gaps drawer must keep apart.
 *
 * The drawer exists because the operator read the evidence before the app drew
 * any of it: a fleet of stale Curator terminals, and no surface anywhere that
 * could say what they cost. So the assertions here are about the things that
 * look fine in a screenshot and are wrong:
 *
 * - **Three drawers are still ONE slot.** A boolean per drawer type-checks and
 *   screenshots fine right up to the moment two are open, one drawn over the
 *   other with the surface behind unreachable. Only an assertion tells that
 *   apart, and adding a third is exactly when a boolean-per-drawer would have
 *   been added.
 * - **Unread is not empty.** Every band has three forms - a door that did not
 *   answer, a measured nothing, and rows - and the first two are different
 *   facts. A drawer that drew "nothing blocks her" over a failed read would be
 *   the most reassuring lie on the page.
 * - **`holds` and `frees` are two numbers.** The row must draw both, because an
 *   impediment holding 99 and freeing 0 is not the best fix on the board.
 * - **A quiet run with no readable clock shows the unknown mark**, never `0m`,
 *   which would read as a session active this second.
 */
import { describe, expect, it } from 'vitest';
import { fireEvent, render } from '@testing-library/react';

import en from '@/i18n/locales/en.json';
import { interpolate } from '@/i18n/useTranslation';
import type { CuratorAttrition } from '@/lib/bindings/CuratorAttrition';
import type { CuratorGrowthReading } from '@/lib/bindings/CuratorGrowthReading';
import type { CuratorImpediment } from '@/lib/bindings/CuratorImpediment';

import { Blueprint } from '../Blueprint';
import type { GapsReading } from '../gaps/useGaps';
import { buildModel } from '../model/buildModel';
import { EMPTY_DOCKET } from '../model/docket';
import type { BlueprintStrings, BlueprintWords } from '../words';
import { BlueprintWordsProvider } from '../words';

import { plan } from './fixture';

const words: BlueprintWords = {
  w: en.companions.blueprint as unknown as BlueprintStrings,
  tx: interpolate,
};
const g = en.companions.blueprint.gaps;

/** Every door unread - the state a page in flight is really in. */
const UNREAD: GapsReading = {
  impediments: null,
  growth: null,
  attrition: null,
  loading: false,
  reload: () => {},
};

/** The real shape measured on 2026-09-26: conform holds 99 and frees none. */
const CONFORM: CuratorImpediment = {
  id: 'undocumented_invocation:conform',
  kind: 'undocumented_invocation',
  engine: 'conform',
  skill: 'conform',
  blocks: 99,
  frees: 0,
  file: 'skills/conform/SKILL.md',
  summary: "'conform' documents no invocation",
  selfFixable: true,
  refusal: null,
};

const QUIET: CuratorAttrition = {
  runs: [
    {
      sessionId: 's1',
      lane: 'plan',
      skill: 'deepen',
      argument: 'agent-operations/agent-run-budgeting',
      state: 'stale',
      reason: 'No log growth for 6 min',
      startedAt: '2026-09-26T09:13:15Z',
      quietMinutes: 58,
      settled: true,
    },
    {
      // The clock could not be read. This row must NOT say "quiet 0m".
      sessionId: 's2',
      lane: null,
      skill: null,
      argument: null,
      state: 'stale',
      reason: null,
      startedAt: null,
      quietMinutes: null,
      settled: false,
    },
  ],
  writtenOff: 6,
  abandoned: 1,
  staleAfterSecs: 360,
};

const GROWTH_FLAT: CuratorGrowthReading = {
  latest: null,
  previous: null,
  deltas: [
    { metric: 'projects', trend: 'flat', change: 0n },
    { metric: 'stale_verdicts', trend: 'grew', change: -247n },
    { metric: 'applied_subjects', trend: 'unknown', change: null },
  ],
  verdict: 'grew',
  flatStreak: 3,
  samples: 4,
};

function renderPage(gaps: GapsReading) {
  return render(
    <BlueprintWordsProvider value={words}>
      <Blueprint model={buildModel(plan())} docket={EMPTY_DOCKET} words={words} gaps={gaps} />
    </BlueprintWordsProvider>,
  );
}

const root = () => document.querySelector('[data-role="cb-blueprint"]')!;
const shut = (el: Element | null) => el?.getAttribute('aria-hidden') === 'true';

describe('the gaps drawer is the third of one slot', () => {
  it('opens on G, shuts on Esc', () => {
    const { container } = renderPage(UNREAD);
    const gaps = () => container.querySelector('[data-role="cb-gaps"]');
    expect(shut(gaps())).toBe(true);

    fireEvent.keyDown(root(), { key: 'g' });
    expect(shut(gaps())).toBe(false);

    fireEvent.keyDown(root(), { key: 'Escape' });
    expect(shut(gaps())).toBe(true);
  });

  it('never holds the surface together with either other drawer', () => {
    const { container } = renderPage(UNREAD);
    const open = () =>
      (['cb-docket', 'cb-queue', 'cb-gaps'] as const).filter(
        (role) => !shut(container.querySelector(`[data-role="${role}"]`)),
      );

    fireEvent.keyDown(root(), { key: 'd' });
    expect(open()).toEqual(['cb-docket']);
    // Each toggle goes through one slot, so this SWAPS rather than stacking.
    fireEvent.keyDown(root(), { key: 'g' });
    expect(open()).toEqual(['cb-gaps']);
    fireEvent.keyDown(root(), { key: 'q' });
    expect(open()).toEqual(['cb-queue']);
    fireEvent.keyDown(root(), { key: 'g' });
    expect(open()).toEqual(['cb-gaps']);
    // And pressing its own key again shuts it rather than reopening it.
    fireEvent.keyDown(root(), { key: 'g' });
    expect(open()).toEqual([]);
  });
});

describe('a door that did not answer is not a door with nothing to report', () => {
  it('draws the unread form in every band, and no zero anywhere', () => {
    const { container } = renderPage(UNREAD);
    fireEvent.keyDown(root(), { key: 'g' });

    // Three bands, three unread marks - not one page-level error and not an
    // empty state standing in for all three.
    expect(container.querySelectorAll('.cb-gap-unread').length).toBeGreaterThanOrEqual(3);
    expect(container.querySelector('[data-role="cb-gaps-blocked-none"]')).toBeNull();
    expect(container.querySelector('[data-role="cb-gaps-quiet-none"]')).toBeNull();
    // The bar's pill is ABSENT while unread, rather than reading zero.
    const toggle = container.querySelector('[data-role="cb-gaps-toggle"]')!;
    expect(toggle.querySelector('.cb-pill')).toBeNull();
  });

  it('draws a measured nothing as an answer, with the pill at zero', () => {
    const { container } = renderPage({
      ...UNREAD,
      impediments: [],
      attrition: { runs: [], writtenOff: 0, abandoned: 0, staleAfterSecs: 360 },
    });
    fireEvent.keyDown(root(), { key: 'g' });

    expect(container.querySelector('[data-role="cb-gaps-blocked-none"]')?.textContent).toBe(
      g.blocked_none,
    );
    expect(container.querySelector('[data-role="cb-gaps-quiet-none"]')?.textContent).toBe(
      g.quiet_none,
    );
    const pill = container.querySelector('[data-role="cb-gaps-toggle"] .cb-pill');
    expect(pill?.textContent).toBe('0');
    expect(pill?.className).toContain('cb-zero');
  });
});

describe('what the rows must say', () => {
  it('draws holds and frees as two figures, so 99-held-0-freed cannot read as the best fix', () => {
    const { container } = renderPage({ ...UNREAD, impediments: [CONFORM] });
    fireEvent.keyDown(root(), { key: 'g' });

    const row = container.querySelector('[data-role="cb-gaps-impediment"]')!;
    expect(row.querySelector('[data-role="cb-gaps-holds"]')?.textContent).toBe(
      interpolate(g.holds, { n: 99 }),
    );
    const frees = row.querySelector('[data-role="cb-gaps-frees"]')!;
    expect(frees.textContent).toBe(interpolate(g.frees, { n: 0 }));
    // Marked, so the stylesheet can mute it without the figure being dropped -
    // a rank nobody can read is a rank nobody can check.
    expect(frees.getAttribute('data-zero')).toBe('yes');
    expect(row.getAttribute('data-mine')).toBe('yes');
  });

  it('shows the unknown mark for a quiet run whose clock could not be read', () => {
    const { container } = renderPage({ ...UNREAD, attrition: QUIET });
    fireEvent.keyDown(root(), { key: 'g' });

    const rows = container.querySelectorAll('[data-role="cb-gaps-quiet"]');
    expect(rows).toHaveLength(2);
    expect(rows[0]!.querySelector('[data-role="cb-gaps-quiet-for"]')?.textContent).toBe(
      interpolate(g.quiet_for, { n: 58 }),
    );
    // The one that matters: NOT "quiet 0m".
    const unknown = rows[1]!.querySelector('[data-role="cb-gaps-quiet-for"]')!;
    expect(unknown.textContent).toBe(g.unknown_mark);
    expect(unknown.textContent).not.toContain('0');
    // And an unsettled run is marked as the leak it is.
    expect(rows[1]!.querySelector('[data-role="cb-gaps-leak"]')).not.toBeNull();
    expect(rows[0]!.querySelector('[data-role="cb-gaps-leak"]')).toBeNull();
  });

  it("carries the fleet's own sentence verbatim rather than summarising it", () => {
    const { container } = renderPage({ ...UNREAD, attrition: QUIET });
    fireEvent.keyDown(root(), { key: 'g' });
    expect(
      container.querySelector('[data-role="cb-gaps-quiet-why"]')?.textContent,
    ).toBe('No log growth for 6 min');
  });

  it('states the threshold from the measurement, not from a literal in the page', () => {
    const { container } = renderPage({
      ...UNREAD,
      attrition: { ...QUIET, staleAfterSecs: 900 },
    });
    fireEvent.keyDown(root(), { key: 'g' });
    expect(container.querySelector('[data-role="cb-gaps-cost"]')?.textContent).toContain(
      interpolate(g.quiet_threshold, { n: 15 }),
    );
  });

  it('keeps a falling stale-verdict count as growth, with its raw sign intact', () => {
    const { container } = renderPage({ ...UNREAD, growth: GROWTH_FLAT });
    fireEvent.keyDown(root(), { key: 'g' });

    const chips = [...container.querySelectorAll('[data-role="cb-gaps-metric"]')];
    const stale = chips.find((c) => c.textContent?.includes(g.metric.stale_verdicts))!;
    expect(stale.getAttribute('data-trend')).toBe('grew');
    expect(stale.textContent).toContain('-247');
    // A metric that moved by zero is not drawn at all; an unreadable one is
    // NAMED rather than dropped, because the verdict was computed without it.
    expect(chips.find((c) => c.textContent?.includes(g.metric.projects))).toBeUndefined();
    expect(
      container.querySelector('[data-role="cb-gaps-metrics-unread"]')?.textContent,
    ).toContain(g.metric.applied_subjects);
    // The figure the owner actually asks for.
    expect(container.querySelector('[data-role="cb-gaps-streak"]')?.textContent).toBe(
      interpolate(g.growth_streak, { n: 3 }),
    );
  });

  it('says one sample is not a trend, instead of drawing a direction', () => {
    const { container } = renderPage({
      ...UNREAD,
      growth: { latest: null, previous: null, deltas: [], verdict: 'unknown', flatStreak: 0, samples: 1 },
    });
    fireEvent.keyDown(root(), { key: 'g' });
    expect(container.querySelector('[data-role="cb-gaps-growth-young"]')?.textContent).toBe(
      g.growth_one_sample,
    );
    expect(container.querySelector('[data-role="cb-gaps-verdict"]')).toBeNull();
  });

  it('names what actually stops her, which is not a budget', () => {
    const { container } = renderPage(UNREAD);
    fireEvent.keyDown(root(), { key: 'g' });
    expect(container.querySelector('[data-role="cb-gaps-stops"]')?.textContent).toBe(g.stops);
  });
});
