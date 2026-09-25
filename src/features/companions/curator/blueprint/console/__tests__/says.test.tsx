/**
 * What the console SAYS after the operator presses something.
 *
 * Two claims live here and each has an obvious wrong implementation that
 * type-checks, lints clean and screenshots fine.
 *
 * 1. **The run control's verdict.** `changed === null` means the run it
 *    superseded could not be read, so whether anything moved is UNKNOWN. The
 *    wrong implementation is `changed ? A : B`, which renders the unknown as
 *    "same projection" - the one reading that would confirm the operator's
 *    wrong conclusion instead of correcting it.
 * 2. **The switch's claim.** Switching her off stops her starting work; it does
 *    NOT close a terminal she already holds. The wrong implementation is the
 *    word "not running" on its own, which says a machine is at rest while two
 *    headless workers are still committing.
 */
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';

import en from '@/i18n/locales/en.json';
import { interpolate } from '@/i18n/useTranslation';

const switchState = {
  status: { id: 'curator', enabled: true, eligible: true, onboarded: true, detail: {} },
  loading: false,
  busy: false,
  locked: false,
  prerequisite: null as string | null,
  toggle: vi.fn(async () => undefined),
};
vi.mock('@/features/companions/status/useCompanionSwitch', () => ({
  useCompanionSwitch: () => switchState,
}));

import type { BlueprintStrings, BlueprintWords } from '../../words';
import { BlueprintWordsProvider } from '../../words';
import { CuratorConsole, type RefreshOutcome } from '../CuratorConsole';
import { RunSwitch } from '../RunSwitch';
import { RuntimeStrip } from '../RuntimeStrip';
import type { CuratorLoop } from '../useCuratorLoop';

import { runtime } from './fixture';

const words: BlueprintWords = {
  w: en.companions.blueprint as unknown as BlueprintStrings,
  tx: interpolate,
};
const W = en.companions.blueprint.console;

function draw(node: ReactElement) {
  return render(<BlueprintWordsProvider value={words}>{node}</BlueprintWordsProvider>);
}

const LOOP: CuratorLoop = {
  requests: [],
  skills: [],
  runtime: runtime(),
  loading: false,
  file: async () => undefined,
  cancel: async () => undefined,
  reload: async () => undefined,
};

function said(outcome: RefreshOutcome | null): string {
  const { container } = draw(
    <CuratorConsole
      loop={LOOP}
      policy={null}
      refreshing={false}
      outcome={outcome}
      onRefresh={async () => undefined}
    />,
  );
  return container.querySelector('[data-role="cb-run-status"]')?.textContent ?? '';
}

describe('the run control says which of its three answers it gave', () => {
  it('says the projection moved, and where the reading came from', () => {
    expect(said({ changed: true, fromCache: false })).toBe(
      interpolate(W.refresh_changed, { source: W.refresh_fresh }),
    );
  });

  it('says the projection did NOT move, which is the whole complaint', () => {
    // An 11-second run and a 2-second one that both return the same projection
    // are what made a working instrument look like a dead button.
    expect(said({ changed: false, fromCache: true })).toBe(
      interpolate(W.refresh_same, { source: W.refresh_cached }),
    );
  });

  it('says UNKNOWN rather than "unchanged" when it could not compare', () => {
    const text = said({ changed: null, fromCache: false });
    expect(text).toBe(interpolate(W.refresh_unknown, { source: W.refresh_fresh }));
    // And it is a different sentence from the "same" one, which is the whole
    // point of keeping the third arm.
    expect(text).not.toBe(interpolate(W.refresh_same, { source: W.refresh_fresh }));
  });

  it('says nothing at all before a run, rather than a verdict about none', () => {
    expect(said(null)).toBe('');
  });

  it('narrates the wait while one is in flight, and not a stale verdict', () => {
    const { container } = draw(
      <CuratorConsole
        loop={LOOP}
        policy={null}
        refreshing
        outcome={{ changed: true, fromCache: false }}
        onRefresh={async () => undefined}
      />,
    );
    expect(container.querySelector('[data-role="cb-run-status"]')?.textContent).toBe(
      W.refresh_working,
    );
  });
});

const CURATOR_ON = { id: 'curator', enabled: true, eligible: true, onboarded: true, detail: {} };
const CURATOR_OFF = { id: 'curator', enabled: false, eligible: true, onboarded: true, detail: {} };

describe('the switch claims what is true and no more', () => {
  it('sits on the state it sets, and names which way pressing it goes', () => {
    switchState.status = CURATOR_ON;
    const { container } = draw(<RunSwitch />);
    expect(container.querySelector('[data-role="cb-switch"]')?.getAttribute('data-state')).toBe('on');
    expect(container.querySelector('[data-testid="curator-run-switch"]')?.getAttribute('aria-label')).toBe(
      W.switch_label_off,
    );
    // It carries NO VISIBLE word of its own: the strip immediately beside it
    // already says "serving ..." or "switched off", and two authorities for one
    // state is how they start to disagree. It also has to fit in the ~50px of
    // slack this row has at 1000x640. The toggle primitive's own `sr-only`
    // state word stays - that is the accessible name, not a label on the row.
    for (const el of container.querySelectorAll('.sr-only')) el.remove();
    expect(container.textContent).toBe('');
  });

  it('says her switch is UNREAD rather than drawing it off', () => {
    switchState.status = null as never;
    const { container } = draw(<RunSwitch />);
    expect(container.querySelector('[data-role="cb-switch"]')?.getAttribute('data-state')).toBe(
      'unread',
    );
    expect(container.querySelector('[data-testid="curator-run-switch"]')?.getAttribute('aria-label')).toBe(
      W.switch_unread,
    );
    expect(container.querySelector('.cb-switch-hold')?.getAttribute('data-cb-tip')).toBe(
      W.switch_unread_tip,
    );
  });

  it('names the missing prerequisite instead of going grey in silence', () => {
    switchState.status = CURATOR_OFF;
    switchState.locked = true;
    switchState.prerequisite = 'no knowledge registry is mapped';
    const { container } = draw(<RunSwitch />);
    expect(container.querySelector('[data-role="cb-switch-locked"]')?.textContent).toBe(
      'no knowledge registry is mapped',
    );
    switchState.locked = false;
    switchState.prerequisite = null;
  });
});

describe('switched off is not the same as nothing running', () => {
  it('explains the pair on the terminals figure rather than hiding it', () => {
    const { container } = draw(
      <RuntimeStrip runtime={runtime({ enabled: false, running: 2 })} policy={null} />,
    );
    // The strip already draws both halves of the fact side by side: "switched
    // off" and "terminals 2 of 2". What it must not do is let the first imply
    // the second is zero.
    expect(container.textContent).toContain(W.runtime_off);
    const terminals = container.querySelector('[data-role="cb-terminals"]');
    expect(terminals?.getAttribute('data-holding')).toBe('true');
    expect(terminals?.getAttribute('data-cb-tip')).toBe(W.runtime_off_holding);
  });

  it('keeps the ordinary terminals tip when she is off and holds none', () => {
    const { container } = draw(
      <RuntimeStrip runtime={runtime({ enabled: false, running: 0 })} policy={null} />,
    );
    const terminals = container.querySelector('[data-role="cb-terminals"]');
    expect(terminals?.getAttribute('data-holding')).toBe('false');
    expect(terminals?.getAttribute('data-cb-tip')).not.toBe(W.runtime_off_holding);
  });
});
