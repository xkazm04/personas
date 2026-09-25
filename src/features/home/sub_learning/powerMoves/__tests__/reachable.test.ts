/**
 * Several power moves deep-link into a surface the sidebar hides — `dead-letter`
 * is devOnly, `executions` is minTier: TEAM, and two moves land in the
 * TEAM-gated Companions section — and the content routers render purely by id
 * with no tier or dev check. A starter build therefore offered a "Try it" that
 * landed the user on a surface with no sidebar row. The quest board now
 * declines to offer a move it cannot land.
 *
 * The Companions cases are the ones that separate the two halves of the rule:
 * their destination PAGE carries no gate of its own, so only the SECTION gate
 * can decline them.
 */
import { describe, it, expect } from 'vitest';
import { TIERS } from '@/lib/constants/uiModes';
import { POWER_MOVES } from '../registry';
import { isPowerMoveReachable } from '../reachable';

const byId = (id: string) => {
  const move = POWER_MOVES.find((m) => m.id === id);
  if (!move) throw new Error(`power move "${id}" is gone — update this test`);
  return move;
};

describe('isPowerMoveReachable', () => {
  it('hides a TEAM-gated TAB from a starter build', () => {
    // bulk-rerun + annotate-golden target overviewTab 'executions' (minTier TEAM).
    const teamGated = POWER_MOVES.filter(
      (m) => 'section' in m.nav && m.nav.overviewTab === 'executions',
    );
    expect(teamGated.length).toBeGreaterThan(0);
    for (const move of teamGated) {
      expect(isPowerMoveReachable(move, TIERS.STARTER)).toBe(false);
      expect(isPowerMoveReachable(move, TIERS.TEAM)).toBe(true);
    }
  });

  it('hides a TEAM-gated SECTION from a starter build, even with an ungated page', () => {
    // `director-coaching` and `athena-fleet` both land in Companions, whose
    // `companionsPage` destinations declare no gate at all. Reading tab gates
    // alone — which is all this module did until 2026-09-22 — would have
    // offered both to a starter build.
    const inCompanions = POWER_MOVES.filter(
      (m) => 'section' in m.nav && m.nav.section === 'companions',
    );
    expect(inCompanions.length).toBeGreaterThan(0);
    for (const move of inCompanions) {
      expect(move.nav).not.toHaveProperty('overviewTab');
      expect(isPowerMoveReachable(move, TIERS.STARTER)).toBe(false);
      expect(isPowerMoveReachable(move, TIERS.TEAM)).toBe(true);
    }
  });

  it('gates the dead-letter move on the dev build flag', () => {
    // `dead-letter` is devOnly, so it is reachable exactly when DEV is on —
    // which it is under vitest. The assertion tracks the flag rather than
    // hardcoding a verdict that would invert in a production bundle.
    expect(isPowerMoveReachable(byId('dead-letter'), TIERS.TEAM)).toBe(import.meta.env.DEV);
  });

  it('always reaches an overlay move — an overlay is summoned, not routed', () => {
    const overlayMoves = POWER_MOVES.filter((m) => 'overlay' in m.nav);
    expect(overlayMoves.length).toBeGreaterThan(0);
    for (const move of overlayMoves) {
      expect(isPowerMoveReachable(move, TIERS.STARTER)).toBe(true);
    }
  });

  it('leaves every ungated move reachable on the lowest tier', () => {
    const ungated = byId('monitor-triage');
    expect(isPowerMoveReachable(ungated, TIERS.STARTER)).toBe(true);
  });
});
