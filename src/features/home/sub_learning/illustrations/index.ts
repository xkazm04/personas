import gettingStarted from './assets/getting-started.webp';
import gettingStartedSimple from './assets/getting-started-simple.webp';
import executionObservability from './assets/execution-observability.webp';
import orchestrationEvents from './assets/orchestration-events.webp';
import pluginsExplorer from './assets/plugins-explorer.webp';
import schedulesMastery from './assets/schedules-mastery.webp';
import templatesRecipes from './assets/templates-recipes.webp';
import teamsOrchestration from './assets/teams-orchestration.webp';
import obsidianBrain from './assets/obsidian-brain.webp';

/**
 * Per-tour decorative background illustrations (Leonardo, Lucid Origin model,
 * /leonardo run 2026-06-17).
 *
 * Each is a very dark navy near-black field with a single glowing geometric
 * subject rendered in that tour's accent color (see {@link getColors}). That
 * lets {@link TourDetailModal} composite the image behind its content as a
 * faint semitransparent wash: `mix-blend-screen` drops the near-black source
 * background out on any theme, leaving only the themed glow — and a top-down
 * mask fades it before it reaches the dense step list.
 *
 * Brand direction (leonardo skill): neon, futuristic, glowing, geometric,
 * clean. The exact briefs used are kept for regeneration in `prompts.json`
 * beside this file, keyed the same way. They are NOT imported: nothing at
 * runtime reads a brief, and as a field here they shipped ~3 KB of prompt text
 * in the Learning chunk. Keyed by `TourDef.id` (TOUR_REGISTRY in tourSlice).
 *
 * **Format: WebP q92, converted from the original PNGs 2026-08-28**
 * (1,149,351 → 488,334 bytes, −57.5%). These carry an enormous quality budget
 * for a wash rendered at `opacity-[0.32]`, and the conversion was measured
 * rather than assumed: per-pixel mean delta < 1/255 and max delta 17–28/255 on
 * isolated pixels, which at 0.32 opacity composites to ≤ ~9/255 worst case.
 * LOSSLESS WebP was measured first and rejected — it came out 2.7x LARGER than
 * these already-tight PNGs. If you regenerate from a prompt, re-encode at q92
 * (`sharp(png).webp({ quality: 92, effort: 6 })`) rather than committing a PNG.
 */
export const TOUR_ILLUSTRATIONS: Record<string, string> = {
  'getting-started': gettingStarted,
  'getting-started-simple': gettingStartedSimple,
  'execution-observability': executionObservability,
  'orchestration-events': orchestrationEvents,
  'plugins-explorer': pluginsExplorer,
  'schedules-mastery': schedulesMastery,
  'templates-recipes': templatesRecipes,
  'teams-orchestration': teamsOrchestration,
  'obsidian-brain': obsidianBrain,
};

/** Resolve a tour's decorative background asset URL, or `undefined` if none. */
export function getTourIllustration(tourId: string): string | undefined {
  return TOUR_ILLUSTRATIONS[tourId];
}
