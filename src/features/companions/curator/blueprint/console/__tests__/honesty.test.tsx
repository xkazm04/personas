/**
 * The nullable fields on this console, held to at the ink.
 *
 * `fannedOut` is `number | null` where the null means UNKNOWN, and it has an
 * obvious wrong implementation that type-checks, lints clean and screenshots
 * fine: `fannedOut ?? 0`. Nothing but an assertion tells that apart from the
 * right one. The same file used to hold the twin case for a skill's nullable
 * `runsBare`; it went when the request composer left this console for the
 * app-wide one, and it comes back with the composer.
 */
import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';

import en from '@/i18n/locales/en.json';
import { interpolate } from '@/i18n/useTranslation';
import type { CuratorPolicy } from '@/lib/bindings/CuratorPolicy';

import type { BlueprintStrings, BlueprintWords } from '../../words';
import { BlueprintWordsProvider } from '../../words';
import { RuntimeStrip } from '../RuntimeStrip';

import { runtime } from './fixture';

// The English catalog is the generated type's own source, so this names the
// invariant rather than hiding a shape mismatch: `types.ts` is codegen'd from
// exactly this file.
const words: BlueprintWords = {
  w: en.companions.blueprint as unknown as BlueprintStrings,
  tx: interpolate,
};
const W = en.companions.blueprint.console;
const NO_CAP = en.companions.blueprint.gauge_no_cap;

function draw(node: ReactElement) {
  return render(<BlueprintWordsProvider value={words}>{node}</BlueprintWordsProvider>);
}

describe('a null fannedOut is unknown, and never a 0', () => {
  it('writes the word and no digit when she cannot see inside a worker', () => {
    const { container } = draw(<RuntimeStrip runtime={runtime({ fannedOut: null })} policy={null} />);
    const cell = container.querySelector('[data-role="cb-fanned"]');
    expect(cell?.getAttribute('data-known')).toBe('false');
    const value = cell?.querySelector('b');
    expect(value?.textContent).toBe(W.fanned_unknown);
    expect(value?.textContent ?? '').not.toMatch(/[0-9]/);
  });

  it('writes the number when she can, so the two are told apart', () => {
    const { container } = draw(<RuntimeStrip runtime={runtime({ fannedOut: 0 })} policy={null} />);
    const cell = container.querySelector('[data-role="cb-fanned"]');
    expect(cell?.getAttribute('data-known')).toBe('true');
    expect(cell?.querySelector('b')?.textContent).toBe('0');
  });

  it('says the runtime is unread rather than drawing a quiet loop', () => {
    const { container } = draw(<RuntimeStrip runtime={null} policy={null} />);
    const strip = container.querySelector('[data-role="cb-runtime"]');
    expect(strip?.getAttribute('data-state')).toBe('unread');
    expect(container.querySelector('[data-role="cb-fanned"]')).toBeNull();
    expect(container.textContent ?? '').not.toMatch(/[0-9]/);
  });
});

describe('a cap is drawn even when nothing has been consumed against it', () => {
  it('renders every brake as used-of-cap with a consumption of zero', () => {
    const { container } = draw(
      <RuntimeStrip
        runtime={runtime({ spentTodayUsd: 0, runsToday: 0, commitsToday: 0 })}
        policy={null}
      />,
    );
    const brakes = [...container.querySelectorAll('[data-role="cb-brake-value"]')];
    expect(brakes).toHaveLength(3);
    // The run cap and the commit cap are whole numbers, so their rendering is
    // exact. The budget goes through the locale currency formatter, so it is
    // asserted by shape rather than against a hard-coded symbol.
    expect(brakes[1]?.textContent).toBe(interpolate(W.used_of, { used: '0', cap: '12' }));
    expect(brakes[2]?.textContent).toBe(interpolate(W.used_of, { used: '0', cap: '3' }));
    expect(brakes[0]?.textContent ?? '').toMatch(/20/);
    for (const b of brakes) expect(b.textContent ?? '').not.toContain(NO_CAP);
  });

  it('says no ceiling is declared rather than drawing a cap of zero', () => {
    const policy: CuratorPolicy = {
      levelResearch: 'L0',
      levelForge: 'L0',
      levelConform: 'L0',
      levelSweep: 'L0',
      dailyBudgetUsd: null,
      dailyRunCap: null,
      dailyCommitCap: null,
      quietHours: null,
      backpressureN: 8,
      workerCap: 2,
    };
    const { container } = draw(<RuntimeStrip runtime={runtime()} policy={policy} />);
    const brakes = [...container.querySelectorAll('[data-role="cb-brake-value"]')];
    expect(brakes).toHaveLength(3);
    for (const b of brakes) expect(b.textContent ?? '').toContain(NO_CAP);
    // and the runtime's own resolved figures never leak in as the ceiling
    expect(brakes[1]?.textContent ?? '').not.toMatch(/12/);
    expect(brakes[2]?.textContent ?? '').not.toMatch(/3/);
  });

  // The fallback arm, which is the one the 2026-09-24 contract fix reaches.
  // Until then the runtime's three caps were plain numbers and an undeclared
  // ceiling arrived here as `0`; with the policy door down, the strip had no
  // way to tell that apart from a DECLARED ceiling of zero, which the settings
  // validator accepts and which means the opposite - "not today".
  it('still says undeclared when the policy door failed and the runtime carries null', () => {
    const { container } = draw(
      <RuntimeStrip
        runtime={runtime({ dailyBudgetUsd: null, dailyRunCap: null, dailyCommitCap: null })}
        policy={null}
      />,
    );
    const brakes = [...container.querySelectorAll('[data-role="cb-brake-value"]')];
    expect(brakes).toHaveLength(3);
    for (const b of brakes) expect(b.textContent ?? '').toContain(NO_CAP);
  });

  it('draws a declared ceiling of zero as a real ceiling, not as undeclared', () => {
    const { container } = draw(
      <RuntimeStrip
        runtime={runtime({ dailyRunCap: 0, runsToday: 0 })}
        policy={null}
      />,
    );
    const brakes = [...container.querySelectorAll('[data-role="cb-brake-value"]')];
    expect(brakes[1]?.textContent).toBe(interpolate(W.used_of, { used: '0', cap: '0' }));
    expect(brakes[1]?.textContent ?? '').not.toContain(NO_CAP);
  });
});
