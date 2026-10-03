/**
 * The machine figure's arithmetic (kit batch home-3, builder FG). The claims under test are the
 * ones that make the drawing MEAN something: the deck's silhouette comes off the worst status, a
 * pier's girth comes off a declared domain rather than off the sample, the courses put the break
 * directly under the deck, and a section that is still loading or has failed never draws a zero as
 * if it were a measurement.
 */
import { describe, expect, it } from 'vitest';

import type { HealthCheckItem } from '@/api/system/system';
import type { HealthCheckStatus } from '@/lib/bindings/HealthCheckStatus';

import { BASE_Y, COURSE_CAP, DECK_Y, GIRTH_FULL_AT, piers } from '../figure/machineModel';
import { HEALTH_SECTION_IDS, type HealthSectionId } from '../healthModel';
import type { HealthSectionState } from '../useHealthSections';

const item = (id: string, status: HealthCheckStatus): HealthCheckItem =>
  ({ id, label: id, status, detail: null, installable: false } as unknown as HealthCheckItem);

const sec = (id: HealthSectionId, statuses: HealthCheckStatus[], extra: Partial<HealthSectionState> = {}): HealthSectionState =>
  ({ id, items: statuses.map((s, i) => item(`${id}-${i}`, s)), loading: false, failed: false, ...extra });

const board = (over: Partial<Record<HealthSectionId, HealthSectionState>> = {}) =>
  HEALTH_SECTION_IDS.map((id) => over[id] ?? sec(id, ['ok']));

describe('machineModel.piers', () => {
  it('draws one pier per environment, on six equal columns', () => {
    const p = piers(board());
    expect(p).toHaveLength(6);
    expect(p.map((x) => x.id)).toEqual([...HEALTH_SECTION_IDS]);
    const widths = new Set(p.map((x, i) => (i ? x.colX - p[i - 1]!.colX : 20)));
    expect(widths).toEqual(new Set([20]));
  });

  it('a machine with nothing wrong carries a flat deck: every span at the resting line', () => {
    const p = piers(board());
    expect(p.every((x) => x.deckY === DECK_Y)).toBe(true);
    expect(new Set(p.map((x) => x.deck))).toEqual(new Set(['solid']));
  });

  it('severity is geometry: the deck steps down further the worse the pier, and breaks on an error', () => {
    const p = piers(board({
      local: sec('local', ['ok', 'warn']),
      environment: sec('environment', ['error', 'ok']),
      agents: sec('agents', ['inactive']),
      cloud: sec('cloud', ['info']),
    }));
    const by = Object.fromEntries(p.map((x) => [x.id, x]));
    expect(by.cloud!.deckY).toBe(DECK_Y);
    expect(by.agents!.deckY).toBeGreaterThan(by.cloud!.deckY);
    expect(by.local!.deckY).toBeGreaterThan(by.agents!.deckY);
    expect(by.environment!.deckY).toBeGreaterThan(by.local!.deckY);
    expect([by.cloud!.deck, by.agents!.deck, by.local!.deck, by.environment!.deck])
      .toEqual(['solid', 'planned', 'sagging', 'broken']);
  });

  it('girth is the environment substance, on a DECLARED domain, so it never re-scales with the sample', () => {
    const few = piers(board({ account: sec('account', ['ok']) })).find((x) => x.id === 'account')!;
    const many = piers(board({ local: sec('local', Array(GIRTH_FULL_AT).fill('ok')) })).find((x) => x.id === 'local')!;
    expect(many.w).toBeGreaterThan(few.w);
    // A section that grows past the declared domain does not make every other pier thinner.
    const huge = piers(board({ local: sec('local', Array(GIRTH_FULL_AT * 3).fill('ok')) }));
    expect(huge.find((x) => x.id === 'local')!.w).toBe(many.w);
    expect(huge.find((x) => x.id === 'account')!.w).toBe(piers(board()).find((x) => x.id === 'account')!.w);
  });

  it('courses are the checks, worst first, so the break sits under the deck it fails to carry', () => {
    const p = piers(board({ local: sec('local', ['ok', 'error', 'warn']) })).find((x) => x.id === 'local')!;
    expect(p.courses.map((c) => c.kind)).toEqual(['error', 'warn', 'ok']);
    // Stacked top-down from the deck to the base, nothing overlapping and nothing past the ground.
    expect(p.courses[0]!.y).toBeCloseTo(p.top, 5);
    const last = p.courses[p.courses.length - 1]!;
    expect(last.y + last.h).toBeCloseTo(BASE_Y, 5);
  });

  it('past the course cap the extra checks become an overflow mark, never hairline courses', () => {
    const p = piers(board({ local: sec('local', Array(COURSE_CAP + 5).fill('ok')) })).find((x) => x.id === 'local')!;
    expect(p.courses).toHaveLength(COURSE_CAP);
    expect(p.overflow).toBe(5);
  });

  it('a loading section holds its geometry on ghost courses and claims no deck state', () => {
    const p = piers(board({ cloud: sec('cloud', [], { loading: true }) })).find((x) => x.id === 'cloud')!;
    expect(p.deck).toBe('ghost');
    expect(p.deckY).toBe(DECK_Y);
    expect(p.courses.map((c) => c.kind)).toEqual(['ghost', 'ghost', 'ghost']);
    expect(p.total).toBe(0);
  });

  it('a failed section draws nothing inside itself: not measured is never drawn as all-clear', () => {
    const p = piers(board({ account: sec('account', [], { failed: true }) })).find((x) => x.id === 'account')!;
    expect(p.failed).toBe(true);
    expect(p.courses).toHaveLength(0);
    expect(p.deck).toBe('broken');
    expect(p.deckY).toBeGreaterThan(DECK_Y);
  });
});
