// The state -> visual-treatment mapping, which is the whole design: each of
// the four states gets its own ring, its own wake line and its own count, and
// a count the DTO did not carry is never drawn as a zero.
import { describe, expect, it } from 'vitest';

import type { Translations } from '@/i18n/generated/types';

import enCompanions from '@/i18n/section-locales/en/companions.json';
import { columnOf, columnsOf } from '../landingModel';
import type { CompanionStatusDto } from '../../types';

// INVARIANT: `section-locales/en/companions.json` IS the `companions` subtree of
// the generated bundle - the generator builds `Translations` from these files,
// and `npm run check:i18n:strict` fails the build if any locale's shape drifts
// from it. The JSON import types the leaves as `string`, which is what the
// model reads.
const T = enCompanions as Translations['companions'];

const athena = (over: Partial<CompanionStatusDto> = {}): CompanionStatusDto => ({
  id: 'athena', enabled: true, eligible: true, onboarded: true, detail: {}, ...over,
});
const overseer = (over: Partial<CompanionStatusDto> = {}): CompanionStatusDto => ({
  id: 'overseer', enabled: true, eligible: true, onboarded: true, detail: {}, ...over,
});
const curator = (over: Partial<CompanionStatusDto> = {}): CompanionStatusDto => ({
  id: 'curator', enabled: true, eligible: true, onboarded: true, detail: {}, ...over,
});
const view = (s: CompanionStatusDto) => columnOf(s, 0, T);

describe('state -> visual treatment', () => {
  it('active: the companion herself, lit, with no wake line', () => {
    const v = view(athena({ detail: { pendingDecisions: 2 } }));
    expect(v.state).toBe('active');
    expect(v.stateWord).toBe(T.state.active);
    expect(v.ring).toEqual({ kind: 'circle' });
    expect(v.working).toBe(true);
    expect(v.beads).toBe(2);
    expect(v.blockerLine).toBeNull();
    expect(v.openLine).toContain('Athena');
    expect(v.target).toBe('athena:setup');
  });

  it('the chip speaks in imperatives; the blocker.* sentences stay with Setup', () => {
    const wakes = [
      view(athena({ enabled: false })).blockerLine,
      view(athena({ onboarded: false })).blockerLine,
      view(overseer({ eligible: false, blocker: 'no_starred_personas' })).blockerLine,
      view(curator({ eligible: false, blocker: 'no_registry' })).blockerLine,
    ];
    expect(wakes).toEqual([
      T.landing.wake_off,
      T.landing.wake_not_onboarded,
      T.landing.wake_no_starred_personas,
      T.landing.wake_no_registry,
    ]);
    for (const w of wakes) expect(w).not.toMatch(/\.$/);
    expect(wakes).not.toContain(T.blocker.no_starred_personas);
  });

  it('off: still herself, but dark, and the wake line says how to switch her on', () => {
    const v = view(athena({ enabled: false }));
    expect(v.state).toBe('off');
    expect(v.stateWord).toBe(T.state.off);
    expect(v.working).toBe(false);
    expect(v.beads).toBe(0);
    expect(v.blockerLine).toBe(T.landing.wake_off);
  });

  it('needs_onboarding: a ring still being drawn, and the door is her own wizard', () => {
    const v = view(athena({ onboarded: false }));
    expect(v.state).toBe('needs_onboarding');
    expect(v.ring).toEqual({ kind: 'drawing' });
    expect(v.blockerLine).toBe(T.landing.wake_not_onboarded);
    expect(v.target).toBe('athena:create-athena');
  });

  it('blocked outranks the switch: a broken ring naming what is missing', () => {
    const v = view(overseer({
      enabled: true, eligible: false, blocker: 'no_starred_personas',
      detail: { starredCount: 0, agentsTotal: 16 },
    }));
    expect(v.state).toBe('blocked');
    expect(v.ring).toEqual({ kind: 'broken', ticks: 16, missing: 'star' });
    expect(v.blockerLine).toBe(T.landing.wake_no_starred_personas);
    expect(v.target).toBe('overseer:setup');
  });

  it("a missing registry breaks Curator's ring with a page, not a star", () => {
    const v = view(curator({ enabled: false, eligible: false, blocker: 'no_registry' }));
    expect(v.ring).toEqual({ kind: 'broken', ticks: 0, missing: 'page' });
    expect(v.blockerLine).toBe(T.landing.wake_no_registry);
  });

  it("Overseer's ring is one tick per agent, lit for the starred ones", () => {
    const v = view(overseer({ detail: { starredCount: 6, agentsTotal: 16 } }));
    expect(v.ring).toEqual({ kind: 'ticks', total: 16, lit: 6 });
    expect(v.count).toEqual({ value: '6/16', label: T.landing.agents_label });
  });
});

describe('a missing count is never a zero', () => {
  it('draws nothing when the DTO omitted the field', () => {
    expect(view(athena()).count).toBeNull();
    expect(view(athena()).beads).toBe(0);
  });

  it('draws a real zero when the DTO carried one', () => {
    expect(view(athena({ detail: { pendingDecisions: 0 } })).count?.value).toBe('0');
  });

  it('says nothing about a fleet that does not exist yet', () => {
    expect(view(overseer({ detail: { starredCount: 0, agentsTotal: 0 } })).count).toBeNull();
  });

  it('draws no count for a registry, which has a name and no number', () => {
    const v = view(curator({ detail: { registryName: 'ai-registry' } }));
    expect(v.count).toBeNull();
    expect(v.ring).toEqual({ kind: 'circle' });
  });
});

describe('the fact line', () => {
  it('names the registry Curator curates, from the one field the DTO carries', () => {
    const v = view(curator({ detail: { registryName: 'ai-registry' } }));
    expect(v.fact).toBe('Registry: ai-registry');
    expect(v.fact).not.toContain('{');
    expect(v.ariaLabel).toContain('ai-registry');
  });

  it('is absent for a companion with no fact on the wire', () => {
    expect(view(athena({ detail: { pendingDecisions: 2 } })).fact).toBeNull();
    expect(view(overseer({ detail: { starredCount: 6, agentsTotal: 16 } })).fact).toBeNull();
    expect(view(curator()).fact).toBeNull();
  });
});

describe('the words', () => {
  it('every column is worded from companions.* and keyed 1, 2, 3 in category order', () => {
    const views = columnsOf([athena(), overseer(), curator()], T);
    expect(views.map((v) => v.index)).toEqual([1, 2, 3]);
    expect(views.map((v) => v.name)).toEqual([T.nav.group_athena, T.nav.group_overseer, T.nav.group_curator]);
    expect(views.map((v) => v.title)).toEqual([T.identity.athena_title, T.identity.overseer_title, T.identity.curator_title]);
    expect(views.map((v) => v.tagline)).toEqual([T.identity.athena_tagline, T.identity.overseer_tagline, T.identity.curator_tagline]);
    // every placeholder is resolved by the shared `interpolate`, in either
    // spelling - an unfilled `{name}` or a left-over `{{name}}` both fail here
    for (const v of views) expect(`${v.name}${v.title}${v.openLine}${v.ariaLabel}`).not.toMatch(/\{/);
  });

  it('the accessible name carries the state, the quantity and the destination', () => {
    const label = view(athena({ detail: { pendingDecisions: 2 } })).ariaLabel;
    expect(label).toContain(T.nav.group_athena);
    expect(label).toContain(T.state.active);
    expect(label).toContain('2');
    expect(label).not.toMatch(/\{/);
  });
});
