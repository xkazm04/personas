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
 * clean. The `prompt` strings are the exact briefs used, kept for
 * regeneration. Keyed by `TourDef.id` (TOUR_REGISTRY in tourSlice).
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
export interface TourIllustration {
  /** Imported asset URL (resolved by Vite). */
  src: string;
  /** Leonardo generation brief, kept for regeneration. */
  prompt: string;
}

export const TOUR_ILLUSTRATIONS: Record<string, TourIllustration> = {
  'getting-started': {
    src: gettingStarted,
    prompt:
      'A glowing violet compass with a luminous winding pathway unfurling from a start point into the distance, onboarding journey mood, neon geometric futuristic style, soft violet-purple glow, clean thin glowing lines, abundant negative space, very dark navy near-black background, premium ambient product illustration',
  },
  'getting-started-simple': {
    src: gettingStartedSimple,
    prompt:
      'A cluster of glowing violet sparkles around a single radiant spark burst, a quick effortless setup magic moment, minimal and airy, neon geometric futuristic style, soft violet-purple glow, clean thin glowing lines, abundant negative space, very dark navy near-black background, premium ambient product illustration',
  },
  'execution-observability': {
    src: executionObservability,
    prompt:
      'A glowing blue heartbeat pulse waveform sweeping across a faint dashboard grid with small luminous data points and a subtle bar chart, live monitoring and observability mood, neon geometric futuristic style, soft sky-blue glow, clean thin glowing lines, abundant negative space, very dark navy near-black background, premium ambient product illustration',
  },
  'orchestration-events': {
    src: orchestrationEvents,
    prompt:
      'Glowing teal concentric broadcast waves radiating outward from a central node, connected event dots scattered around it joined by thin arcs, signal and event-bus propagation mood, neon geometric futuristic style, soft teal-cyan glow, clean thin glowing lines, abundant negative space, very dark navy near-black background, premium ambient product illustration',
  },
  'plugins-explorer': {
    src: pluginsExplorer,
    prompt:
      'Glowing amber interlocking puzzle pieces and modular blocks plugging into a faint grid, plugin extensibility and modularity mood, neon geometric futuristic style, soft amber-gold glow, clean thin glowing edges, abundant negative space, very dark navy near-black background, premium ambient product illustration',
  },
  'schedules-mastery': {
    src: schedulesMastery,
    prompt:
      'A glowing emerald clock face overlaid on a faint calendar grid with orbiting time rings and small luminous tick marks, scheduling and time-mastery mood, neon geometric futuristic style, soft emerald-green glow, clean thin glowing lines, abundant negative space, very dark navy near-black background, premium ambient product illustration',
  },
  'templates-recipes': {
    src: templatesRecipes,
    prompt:
      'A glowing indigo laboratory flask beside layered blueprint template sheets and a small stack of recipe step cards, reusable templates and recipes mood, neon geometric futuristic style, soft indigo-blue glow, clean thin glowing lines, abundant negative space, very dark navy near-black background, premium ambient product illustration',
  },
  'teams-orchestration': {
    src: teamsOrchestration,
    prompt:
      'A glowing emerald branching network graph of connected agent nodes forming a pipeline, like a git branch diagram of a coordinated team, multi-agent orchestration mood, neon geometric futuristic style, soft spring-green glow, clean thin glowing lines, abundant negative space, very dark navy near-black background, premium ambient product illustration',
  },
  'obsidian-brain': {
    src: obsidianBrain,
    prompt:
      'A glowing violet neural network forming the silhouette of a brain from connected luminous nodes and synapse lines, knowledge graph and long-term memory vault mood, neon geometric futuristic style, soft violet-purple glow, clean thin glowing lines, abundant negative space, very dark navy near-black background, premium ambient product illustration',
  },
};

/** Resolve a tour's decorative background asset URL, or `undefined` if none. */
export function getTourIllustration(tourId: string): string | undefined {
  return TOUR_ILLUSTRATIONS[tourId]?.src;
}
