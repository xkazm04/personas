import type { Translations } from '@/i18n/generated/types';

/**
 * Localized verdict word for a 0-100 lab score. `null` means the metric was never
 * scored (sandbox runs carry no tool accuracy) and reads as "Unscored", not "Poor".
 * Single source for the arena results view and the scenario detail panel.
 */
export function scoreLabel(t: Translations, score: number | null): string {
  const lab = t.agents.lab;
  if (score == null) return lab.score_unscored;
  if (score >= 80) return lab.score_excellent;
  if (score >= 60) return lab.score_good;
  if (score >= 40) return lab.score_fair;
  if (score >= 20) return lab.score_weak;
  return lab.score_poor;
}
