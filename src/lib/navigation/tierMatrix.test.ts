/**
 * TIER MATRIX — what each product tier actually shows, enumerated.
 *
 * This test replaces two thirds of `npm run check:tiers`.
 *
 * WHAT THE GATE USED TO BE. `scripts/check-tiers.mjs` spawned `npx vite build`
 * three times with `VITE_APP_TIER` set to starter / team / builder and asserted
 * the **exit code**. It never read the output, never diffed the bundles, and
 * never verified the variable reached Vite at all — and all three builds wrote
 * to the same `dist/`, so it could not have compared them even in principle.
 * The repo's own audit says so in
 * `docs/concepts/golden-paths/tier-and-capability-gating.md` §7 items 4-5.
 * Compilation was the one property that was never in doubt: the tiers differ by
 * ONE `import.meta.env` read and there is no per-tier `define` or tree-shaking,
 * so a tier build cannot fail to compile unless the untiered build already did.
 *
 * WHAT IT IS NOW. One Vite build proves the bundle still builds; this file
 * proves the GATING LOGIC — which surfaces each tier shows, that the tiers nest,
 * that no gate points at a surface that no longer exists, and that the tier
 * resolver genuinely reads `import.meta.env.VITE_APP_TIER` (the precondition the
 * old gate was blind to).
 *
 * WHAT IS STILL NOT PROVEN, and must not be claimed: that Vite's *build-time*
 * substitution delivers `VITE_APP_TIER` into `uiModes.ts`. The last describe
 * below proves the resolver reads the variable when something sets it; proving
 * the bundler sets it needs a probe build, which is registered as fix 3 in the
 * golden path's §9 and deliberately not taken here (it would restore a second
 * build). See the note in that doc.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { TIERS, TIER_RANK, isTierVisible, type Tier } from '@/lib/constants/uiModes';
import { NAV_SECTIONS, passesGates } from '@/lib/navigation/registry';
import {
  overviewItems,
  credentialItems,
  eventBusItems,
  templateItems,
  devToolsItems,
  getSettingsItems,
  filterByTier,
} from '@/features/shared/chrome/sidebar/sidebarData';

const ALL_TIERS = [TIERS.STARTER, TIERS.TEAM, TIERS.BUILDER] as const;

/**
 * The declaring tables, by the surface family they gate. Everything here is
 * READ FROM THE SOURCE OF TRUTH — if a table grows a row, this test sees it.
 *
 * `devOnly` rows are excluded throughout: the matrix is about the TIER axis in
 * a production build, and mixing the dev axis in would let a dev-gate change
 * silently absorb a tier-gate change.
 *
 * NOT ENUMERABLE, and therefore not covered — a finding, not an omission:
 * `EditorTabBar.tsx`'s `tabDefs` gates the `activity` and `lab` persona-editor
 * tabs at `TIERS.TEAM` from a module-private const inside a component file. No
 * test can reach it without rendering the component. Exporting that array is a
 * one-line change that would bring 2 more declarations under this matrix.
 */
const TABLES: Record<string, ReadonlyArray<{ id: string; minTier?: Tier; devOnly?: boolean }>> = {
  'nav-section': NAV_SECTIONS.map((e) => ({ id: e.id, minTier: e.gates.minTier, devOnly: e.gates.devOnly })),
  'overview-tab': overviewItems,
  'connections-tab': credentialItems,
  'events-tab': eventBusItems,
  'templates-tab': templateItems,
  'dev-tools-tab': devToolsItems,
};

/** Every surface a production build of `tier` shows, as stable `table:id` keys. */
function allowedFor(tier: Tier): string[] {
  const keys: string[] = [];
  for (const [table, items] of Object.entries(TABLES)) {
    for (const item of filterByTier([...items], tier)) {
      if (item.devOnly) continue;
      keys.push(`${table}:${item.id}`);
    }
  }
  // Settings does its own filtering inside the accessor, so ask it rather than
  // re-deriving — a re-derivation here would be a second implementation of the
  // rule and could agree with nothing.
  for (const item of getSettingsItems(false, tier)) keys.push(`settings-tab:${item.id}`);
  return keys.sort();
}

/** Every surface declared with an explicit `minTier`, as the same keys. */
function declaredGates(): string[] {
  const keys: string[] = [];
  for (const [table, items] of Object.entries(TABLES)) {
    for (const item of items) if (item.minTier && !item.devOnly) keys.push(`${table}:${item.id}`);
  }
  // getSettingsItems hides its table; derive its gated rows from the difference
  // between the widest and narrowest tiers, which is what a gate MEANS there.
  const widest = new Set(getSettingsItems(false, TIERS.BUILDER).map((i) => i.id));
  for (const id of getSettingsItems(false, TIERS.STARTER).map((i) => i.id)) widest.delete(id);
  for (const id of widest) keys.push(`settings-tab:${id}`);
  return keys.sort();
}

/**
 * THE FROZEN SET: exactly the surfaces a starter build loses.
 *
 * Written out rather than derived so that re-gating a surface has to be a
 * deliberate two-line diff a reviewer can read, instead of a table edit the
 * test silently absorbs. If this list changes, say why in the commit message.
 */
const EXPECTED_TEAM_ONLY = [
  'connections-tab:databases',
  'nav-section:companions',
  'nav-section:events',
  'nav-section:plugins',
  'nav-section:teams',
  'overview-tab:events',
  'overview-tab:executions',
  'overview-tab:incidents',
  'overview-tab:manual-review',
  'overview-tab:memories',
  'overview-tab:memory-graph',
  'overview-tab:patterns',
  'settings-tab:api-keys',
  'settings-tab:limits',
  'settings-tab:portability',
  'templates-tab:n8n',
  'templates-tab:presets',
].sort();

describe('tier matrix — the tables themselves', () => {
  it('enumerates a real surface set (a matrix over nothing must not pass)', () => {
    // Floors, not equalities: the point is that an empty or collapsed table
    // reads as a failure rather than as "no drift". The audit records 21
    // minTier declarations across five arrays; 17 of them are enumerable here.
    expect(NAV_SECTIONS.length).toBeGreaterThanOrEqual(10);
    expect(Object.keys(TABLES).length).toBe(6);
    expect(allowedFor(TIERS.BUILDER).length).toBeGreaterThanOrEqual(40);
    expect(declaredGates().length).toBeGreaterThanOrEqual(15);
  });

  it('gates no surface that does not exist', () => {
    // A gate on a dead id hides nothing and reads as protection. Every declared
    // gate must name a row that is still in its table, and no gated nav section
    // may be `reachability: 'hidden'`.
    const live = new Set(allowedFor(TIERS.BUILDER));
    for (const key of declaredGates()) {
      expect(live.has(key), `gate on a surface no tier can reach: ${key}`).toBe(true);
    }
    for (const entry of NAV_SECTIONS) {
      if (entry.gates.minTier) expect(entry.reachability).not.toBe('hidden');
    }
  });

  it('every surface a tier loses is lost because of a DECLARED gate', () => {
    // The other direction: nothing may differ between tiers for an undeclared
    // reason. If this fails, a surface is disappearing through an ambient
    // `useTier()` boolean instead of a `minTier` a test can enumerate.
    const starter = new Set(allowedFor(TIERS.STARTER));
    const lost = allowedFor(TIERS.BUILDER).filter((k) => !starter.has(k));
    expect(lost.sort()).toEqual(declaredGates());
  });
});

describe('tier matrix — the exact allowed set per tier', () => {
  it('starter shows everything except the frozen team-gated list', () => {
    const builder = allowedFor(TIERS.BUILDER);
    const starter = allowedFor(TIERS.STARTER);
    expect(builder.filter((k) => !starter.includes(k))).toEqual(EXPECTED_TEAM_ONLY);
    expect(starter).toEqual(builder.filter((k) => !EXPECTED_TEAM_ONLY.includes(k)));
  });

  it('team shows the frozen list, and builder adds NOTHING to it', () => {
    // Recorded as a finding, not a bug: there are ZERO `minTier: TIERS.BUILDER`
    // declarations in the repo, so team and builder are the same surface set.
    // The old gate spent a third of its runtime building the second of two
    // identical bundles. If a builder-only gate is ever added, this assertion
    // is where it announces itself.
    expect(allowedFor(TIERS.TEAM)).toEqual(allowedFor(TIERS.BUILDER));
    for (const key of EXPECTED_TEAM_ONLY) expect(allowedFor(TIERS.TEAM)).toContain(key);
  });
});

describe('tier matrix — monotonicity is the intended model, proven from the resolver', () => {
  it('ranks the tiers strictly and nests their surface sets', () => {
    expect(TIER_RANK[TIERS.STARTER]).toBeLessThan(TIER_RANK[TIERS.TEAM]);
    expect(TIER_RANK[TIERS.TEAM]).toBeLessThan(TIER_RANK[TIERS.BUILDER]);

    // Exhaustive over all 9 (minTier, activeTier) pairs: `isTierVisible` is the
    // one function every surface family routes through, so monotonicity proven
    // here is monotonicity everywhere — not an assumption about the tables.
    for (const min of ALL_TIERS) {
      for (const active of ALL_TIERS) {
        expect(isTierVisible(min, active)).toBe(TIER_RANK[active] >= TIER_RANK[min]);
      }
    }

    // Each tier's set must be a SUPERSET of the one below it — widen, never
    // narrow. Written as explicit pairs rather than index arithmetic: under
    // `noUncheckedIndexedAccess`, `ALL_TIERS[i]` is `Tier | undefined`, and
    // silencing that with a `!` would be an assertion with no invariant behind it.
    const ADJACENT_PAIRS: ReadonlyArray<readonly [Tier, Tier]> = [
      [TIERS.STARTER, TIERS.TEAM],
      [TIERS.TEAM, TIERS.BUILDER],
    ];
    for (const [lowerTier, higherTier] of ADJACENT_PAIRS) {
      const higher = allowedFor(higherTier);
      for (const key of allowedFor(lowerTier)) {
        expect(higher, `${higherTier} dropped ${key}, which ${lowerTier} shows`).toContain(key);
      }
    }
  });

  it('agrees with passesGates, the one function the sidebar/router/palette share', () => {
    for (const tier of ALL_TIERS) {
      const ctx = { isDev: false, isTierVisible: (min: Tier) => isTierVisible(min, tier) };
      const viaGates = NAV_SECTIONS.filter((e) => passesGates(e.gates, ctx)).map((e) => `nav-section:${e.id}`);
      const viaMatrix = allowedFor(tier).filter((k) => k.startsWith('nav-section:'));
      expect(viaMatrix).toEqual(viaGates.sort());
    }
  });
});

describe('the tier resolver reads import.meta.env.VITE_APP_TIER', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  /**
   * The blindness this closes: `check:tiers` set `VITE_APP_TIER` and asserted an
   * exit code, so if the read at `uiModes.ts` were ever deleted or renamed,
   * every tier build would silently become the builder build and the gate would
   * report three green ticks.
   */
  it.each([TIERS.STARTER, TIERS.TEAM, TIERS.BUILDER])('resolves BUILD_MAX_TIER=%s', async (tier) => {
    vi.stubEnv('VITE_APP_TIER', tier);
    vi.resetModules();
    const mod = await import('@/lib/constants/uiModes');
    expect(mod.BUILD_MAX_TIER).toBe(tier);
    expect(mod.isTierAvailable(TIERS.STARTER)).toBe(true);
    expect(mod.isTierAvailable(TIERS.BUILDER)).toBe(tier === TIERS.BUILDER);
  });

  it('falls back to builder when the variable is unset — which is what ships', () => {
    // release.yml sets no VITE_APP_TIER, so every published installer is the
    // builder bundle. Asserted rather than assumed, because the fallback is the
    // real production configuration and nothing else states it.
    vi.stubEnv('VITE_APP_TIER', undefined as unknown as string);
    vi.resetModules();
    return import('@/lib/constants/uiModes').then((mod) => {
      expect(mod.BUILD_MAX_TIER).toBe(TIERS.BUILDER);
    });
  });
});
