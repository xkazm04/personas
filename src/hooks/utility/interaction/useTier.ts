/**
 * useTier — unified hook for the tiered feature gate system.
 *
 * Replaces the scattered useSimpleMode / useDevMode hooks with a single
 * source of truth. Components check `tier.isVisible('team')` to decide
 * whether to render a feature.
 */

import { useSystemStore } from "@/stores/systemStore";
import {
  type Tier,
  TIERS,
  TIER_RANK,
  BUILD_MAX_TIER,
  isTierAvailable,
} from "@/lib/constants/uiModes";

export interface TierInfo {
  /** The user's currently selected tier. */
  current: Tier;

  /** Whether a feature requiring `minTier` should be visible. */
  isVisible: (minTier: Tier) => boolean;

  /** Convenience: true when current tier is starter (non-technical UI). */
  isStarter: boolean;

  /** Convenience: true when current tier includes team features. */
  isTeam: boolean;

  /** Convenience: true when current tier includes builder/dev features. */
  isBuilder: boolean;

  /** Maximum tier this build supports (set by VITE_APP_TIER). */
  buildMaxTier: Tier;

  /** Whether a tier is available in this build. */
  isTierAvailable: (tier: Tier) => boolean;
}

export function useTier(): TierInfo {
  const current = useSystemStore((s) => s.viewMode) as Tier;
  const rank = TIER_RANK[current];

  return {
    current,
    isVisible: (minTier: Tier) => rank >= TIER_RANK[minTier],
    isStarter: current === TIERS.STARTER,
    isTeam: rank >= TIER_RANK[TIERS.TEAM],
    isBuilder: rank >= TIER_RANK[TIERS.BUILDER],
    buildMaxTier: BUILD_MAX_TIER,
    isTierAvailable,
  };
}
