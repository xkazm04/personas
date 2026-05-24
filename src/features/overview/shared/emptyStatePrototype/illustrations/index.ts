import type { IllustrationMotif } from '../types';
import approvalHero from './assets/approval.png';
import messagesHero from './assets/messages.png';
import leaderboardHero from './assets/leaderboard.png';
import approvalHeroLight from './assets/approval-light.png';
import messagesHeroLight from './assets/messages-light.png';
import leaderboardHeroLight from './assets/leaderboard-light.png';

/**
 * Leonardo-generated hero illustrations for the Illustration variant
 * (Lucid Origin model, /prototype run 2026-05-24).
 *
 * Dark-background originals, blended into the app background by a radial edge
 * mask in {@link IllustrationEmptyState}. `srcLight` holds a light-theme
 * alternate (darker subject on a light field) so the hero keeps contrast on
 * light themes; the component swaps by active theme.
 *
 * Brand direction (leonardo skill): neon, futuristic, glowing, geometric, clean.
 * The `prompt` strings are the exact briefs used, kept for regeneration.
 */

export interface IllustrationEntry {
  /** Dark-theme hero asset URL. */
  src: string;
  /** Light-theme hero asset URL; falls back to `src` when null. */
  srcLight: string | null;
  /** Leonardo generation brief (dark theme). */
  prompt: string;
}

export const ILLUSTRATIONS: Record<IllustrationMotif, IllustrationEntry> = {
  approval: {
    src: approvalHero,
    srcLight: approvalHeroLight,
    prompt:
      'A glowing emerald approval checkmark inside a floating geometric review tray, a small neat stack of translucent review cards being cleared, calm all caught up mood, neon geometric futuristic style, soft emerald glow, clean edges, dark background, premium product illustration',
  },
  messages: {
    src: messagesHero,
    srcLight: messagesHeroLight,
    prompt:
      'Three luminous blue conversation bubbles connected by a glowing thread, forming a persona dialogue, floating in dark space, neon geometric futuristic style, soft sky-blue glow, clean edges, dark background, premium product illustration',
  },
  leaderboard: {
    src: leaderboardHero,
    srcLight: leaderboardHeroLight,
    prompt:
      'A glowing amber-gold winners podium with three ranked light bars and a radiant star crowning the tallest, achievement and ranking mood, neon geometric futuristic style, soft golden glow, clean edges, dark background, premium product illustration',
  },
};

export function getIllustration(motif: IllustrationMotif): IllustrationEntry {
  return ILLUSTRATIONS[motif];
}
