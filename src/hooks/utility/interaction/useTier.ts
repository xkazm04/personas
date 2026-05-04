/**
 * useTier — feature-gate hook backed by the build-time tier constant.
 *
 * The runtime "Simple vs Power" mode toggle was retired; the app now ships
 * with a single mode determined at build time via VITE_APP_TIER. Components
 * still call `tier.isVisible('team')` to gate features that only make sense
 * at higher tiers within multi-tier bundles.
 */

import {
  type Tier,
  TIERS,
  TIER_RANK,
  BUILD_MAX_TIER,
  isTierAvailable,
} from "@/lib/constants/uiModes";

export interface TierInfo {
  /** The active tier — equal to BUILD_MAX_TIER (no runtime override). */
  current: Tier;

  /** Whether a feature requiring `minTier` should be visible. */
  isVisible: (minTier: Tier) => boolean;

  /** Convenience: true when the active tier is starter (always false in non-starter bundles). */
  isStarter: boolean;

  /** Convenience: true when the active tier includes team features. */
  isTeam: boolean;

  /** Convenience: true when the active tier includes builder/dev features. */
  isBuilder: boolean;

  /** Maximum tier this build supports (set by VITE_APP_TIER). */
  buildMaxTier: Tier;

  /** Whether a tier is available in this build. */
  isTierAvailable: (tier: Tier) => boolean;
}

export function useTier(): TierInfo {
  const current = BUILD_MAX_TIER;
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
