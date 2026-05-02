/**
 * Simple-mode public surface.
 *
 * The default export is the lazy-loaded entry point; PersonasPage
 * dynamic-imports this module when `viewMode === TIERS.STARTER`.
 *
 * `ModeComparisonCard` is reused outside Simple mode by the onboarding
 * AppearanceStep and the Settings AppearanceSettings panel — keep it on
 * the public surface.
 *
 * Internal modules (hooks, adapters, utils, _shared) are NOT re-exported
 * here. Internal consumers import from their concrete paths to keep the
 * public surface small.
 */
export { default } from './SimpleHomePage';

export { ModeComparisonCard } from './components/ModeComparisonCard';
export type { ModeComparisonCardProps } from './components/ModeComparisonCard';
