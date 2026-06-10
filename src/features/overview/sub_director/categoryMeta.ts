import type { LucideIcon } from 'lucide-react';
import { FileText, HeartPulse, Zap, KeyRound, Brain, Target, Tag } from 'lucide-react';
import type { Translations } from '@/i18n/en';

/**
 * Director verdict-category visual language — icon + tone + label per category.
 *
 * The backend tags every verdict with a `category` (prompt / health / triggers /
 * credentials / memory / usefulness) but the UI only ever surfaced `severity`.
 * This shared map lets the detail modal show *what kind* of issue each verdict
 * is. Unknown/new categories fall back to a neutral tag so the UI never breaks
 * if the Rust enum grows.
 */

export type DirectorCategory =
  | 'prompt'
  | 'health'
  | 'triggers'
  | 'credentials'
  | 'memory'
  | 'usefulness';

export const CATEGORY_META: Record<DirectorCategory, { icon: LucideIcon; color: string }> = {
  prompt: { icon: FileText, color: 'var(--status-info)' },
  health: { icon: HeartPulse, color: 'var(--status-error)' },
  triggers: { icon: Zap, color: 'var(--status-warning)' },
  credentials: { icon: KeyRound, color: 'var(--status-warning)' },
  memory: { icon: Brain, color: 'var(--primary)' },
  usefulness: { icon: Target, color: 'var(--status-success)' },
};

const FALLBACK = { icon: Tag, color: 'var(--muted-foreground)' };

/** Icon + tone for a category token; neutral fallback for unknown values. */
export function categoryMeta(category: string): { icon: LucideIcon; color: string } {
  return CATEGORY_META[category as DirectorCategory] ?? FALLBACK;
}

/** Localized label for a category token; echoes the raw token if unmapped. */
export function categoryLabel(t: Translations, category: string): string {
  switch (category) {
    case 'prompt':
      return t.director.category_prompt;
    case 'health':
      return t.director.category_health;
    case 'triggers':
      return t.director.category_triggers;
    case 'credentials':
      return t.director.category_credentials;
    case 'memory':
      return t.director.category_memory;
    case 'usefulness':
      return t.director.category_usefulness;
    default:
      return category;
  }
}
