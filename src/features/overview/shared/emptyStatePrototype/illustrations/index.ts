import type { EmptyStateMotif } from '../types';

/**
 * Leonardo-generated hero illustrations for the Illustration variant.
 *
 * Generation is a separate batch step (see /prototype run 2026-05-24, task #8).
 * Until each PNG lands in `./assets/`, `src` is `null` and
 * {@link IllustrationEmptyState} renders a styled placeholder so the layout is
 * still reviewable. The `prompt` strings below are the exact briefs handed to
 * `/leonardo` (State illustration type → transparent bg via remove-bg pipeline).
 *
 * Brand direction (from the leonardo skill): Personas = neon android head,
 * futuristic, glowing, geometric, clean. Each prompt keeps that DNA but bends
 * it to the module's metaphor + accent color.
 */

export interface IllustrationEntry {
  /** Imported asset URL once generated; `null` shows the placeholder. */
  src: string | null;
  /** Leonardo generation brief. */
  prompt: string;
}

export const ILLUSTRATIONS: Record<EmptyStateMotif, IllustrationEntry> = {
  activity: {
    src: null,
    prompt:
      'A sleek futuristic monitoring console floating in dark space, a glowing cyan execution-pulse waveform arcing across a transparent timeline, faint orbiting data nodes, neon geometric style, clean edges, soft cyan glow, dark transparent background, isometric, premium product illustration',
  },
  approval: {
    src: null,
    prompt:
      'A glowing emerald approval checkmark inside a floating geometric review tray, a small neat stack of translucent review cards being cleared, calm "all caught up" mood, neon geometric futuristic style, soft emerald glow, clean edges, dark transparent background, premium product illustration',
  },
  messages: {
    src: null,
    prompt:
      'Three luminous blue conversation bubbles connected by a glowing thread, forming a persona dialogue, floating in dark space, neon geometric futuristic style, soft sky-blue glow, clean edges, dark transparent background, premium product illustration',
  },
  knowledge: {
    src: null,
    prompt:
      'A glowing violet knowledge constellation, interconnected nodes and edges forming a neural knowledge graph around a brighter central hub, neon geometric futuristic style, soft violet glow, clean edges, dark transparent background, premium product illustration',
  },
  memories: {
    src: null,
    prompt:
      'A radiant fuchsia-magenta memory core, a faceted crystalline diamond shape with smaller memory shards converging toward it along glowing synapse lines, neon geometric futuristic style, soft magenta glow, clean edges, dark transparent background, premium product illustration',
  },
  leaderboard: {
    src: null,
    prompt:
      'A glowing amber-gold winners podium with three ranked light bars and a radiant star crowning the tallest, achievement and ranking mood, neon geometric futuristic style, soft golden glow, clean edges, dark transparent background, premium product illustration',
  },
};

export function getIllustration(motif: EmptyStateMotif): IllustrationEntry {
  return ILLUSTRATIONS[motif];
}
