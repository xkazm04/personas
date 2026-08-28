import { describe, expect, it } from 'vitest';
import { SECTION_ROUTES } from '@/features/personas/sectionRouter';
import anchorManifest from '@/features/onboarding/anchors/tourAnchorManifest.json';
import { POWER_MOVES, POWER_MOVE_GROUPS } from '../registry';

/**
 * Ground-truth checks for the hand-written power-move registry. Both lists it
 * references are enumerated elsewhere, so the assertions derive from those
 * enumerations rather than from a second hand-written copy:
 *
 * - routability comes from `SECTION_ROUTES` (the content router's own map,
 *   `satisfies Record<RoutableSection, …>`);
 * - anchor existence comes from `tourAnchorManifest.json`, the generated
 *   inventory of every `data-testid` in the tree.
 *
 * The first assertion is the regression guard for the `schedule-delay` move,
 * which pointed at `section: 'schedules'` — a section that is overlay-only and
 * has no route, so "Try it" dropped the user on the All Agents fallback.
 */
describe('POWER_MOVES registry', () => {
  const testids = new Set((anchorManifest as { testids: string[] }).testids);

  it('routes every section move at a section the content router can render', () => {
    const unroutable = POWER_MOVES.filter(
      (m) => 'section' in m.nav && !(m.nav.section in SECTION_ROUTES),
    ).map((m) => m.id);
    expect(unroutable).toEqual([]);
  });

  it('points every spotlight at a testid the anchor manifest knows', () => {
    const unknown = POWER_MOVES.filter(
      (m) => m.spotlightTestId !== undefined && !testids.has(m.spotlightTestId),
    ).map((m) => `${m.id} -> ${m.spotlightTestId}`);
    expect(unknown).toEqual([]);
  });

  it('has unique ids and a declared group for every move', () => {
    const ids = POWER_MOVES.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    const groups = new Set(POWER_MOVE_GROUPS.map((g) => g.key));
    expect(POWER_MOVES.filter((m) => !groups.has(m.group)).map((m) => m.id)).toEqual([]);
  });

  it('renders every group with at least one move', () => {
    const used = new Set(POWER_MOVES.map((m) => m.group));
    expect(POWER_MOVE_GROUPS.filter((g) => !used.has(g.key)).map((g) => g.key)).toEqual([]);
  });
});
