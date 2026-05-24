import type { EmptyStateMotif } from '../types';
import activityHero from './assets/activity.png';
import approvalHero from './assets/approval.png';
import messagesHero from './assets/messages.png';
import knowledgeHero from './assets/knowledge.png';
import memoriesHero from './assets/memories.png';
import leaderboardHero from './assets/leaderboard.png';

/**
 * Leonardo-generated hero illustrations for the Illustration variant
 * (Lucid Origin model, /prototype run 2026-05-24).
 *
 * These are the *dark-background* originals, used as-is: the background-removal
 * pipeline keyed out the diffuse-glow subjects (knowledge constellation,
 * memory core) almost entirely, while the dark originals blend cleanly into the
 * app's dark theme. {@link IllustrationEmptyState} applies a radial mask to fade
 * the square edges into transparency, so the glowing subject reads as a hero
 * with no visible frame.
 *
 * Brand direction (leonardo skill): neon, futuristic, glowing, geometric, clean.
 * The `prompt` strings are the exact briefs used, kept for regeneration.
 */

export interface IllustrationEntry {
  /** Imported asset URL; `null` falls back to the placeholder. */
  src: string | null;
  /** Leonardo generation brief. */
  prompt: string;
}

export const ILLUSTRATIONS: Record<EmptyStateMotif, IllustrationEntry> = {
  activity: {
    src: activityHero,
    prompt:
      'A sleek futuristic monitoring console floating in dark space, a glowing cyan execution-pulse waveform arcing across a transparent timeline, faint orbiting data nodes, neon geometric style, clean edges, soft cyan glow, dark background, isometric, premium product illustration',
  },
  approval: {
    src: approvalHero,
    prompt:
      'A glowing emerald approval checkmark inside a floating geometric review tray, a small neat stack of translucent review cards being cleared, calm all caught up mood, neon geometric futuristic style, soft emerald glow, clean edges, dark background, premium product illustration',
  },
  messages: {
    src: messagesHero,
    prompt:
      'Three luminous blue conversation bubbles connected by a glowing thread, forming a persona dialogue, floating in dark space, neon geometric futuristic style, soft sky-blue glow, clean edges, dark background, premium product illustration',
  },
  knowledge: {
    src: knowledgeHero,
    prompt:
      'A glowing violet knowledge constellation, interconnected nodes and edges forming a neural knowledge graph around a brighter central hub, neon geometric futuristic style, soft violet glow, clean edges, dark background, premium product illustration',
  },
  memories: {
    src: memoriesHero,
    prompt:
      'A radiant fuchsia-magenta memory core, a faceted crystalline diamond shape with smaller memory shards converging toward it along glowing synapse lines, neon geometric futuristic style, soft magenta glow, clean edges, dark background, premium product illustration',
  },
  leaderboard: {
    src: leaderboardHero,
    prompt:
      'A glowing amber-gold winners podium with three ranked light bars and a radiant star crowning the tallest, achievement and ranking mood, neon geometric futuristic style, soft golden glow, clean edges, dark background, premium product illustration',
  },
};

export function getIllustration(motif: EmptyStateMotif): IllustrationEntry {
  return ILLUSTRATIONS[motif];
}
