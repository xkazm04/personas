import type { BuildPhase } from '@/lib/types/buildTypes';
import type { Translations } from '@/i18n/generated/types';

/**
 * Cell-key → translated label resolver.
 *
 * The matrix uses kebab-case cell keys (e.g. `'use-cases'`, `'human-review'`)
 * for state plumbing, while user-visible labels live under
 * `t.templates.matrix.dim_*`. This helper bridges the two so the component
 * keeps using cell keys but UI strings flow through i18n.
 *
 * Replaces the previous `CELL_FRIENDLY_NAMES` constant which hardcoded English.
 */
export function getCellFriendlyName(t: Translations, cellKey: string): string {
  const matrix = t.templates.matrix;
  switch (cellKey) {
    case 'use-cases': return matrix.dim_tasks;
    case 'connectors': return matrix.dim_apps;
    case 'triggers': return matrix.dim_schedule;
    case 'human-review': return matrix.dim_review;
    case 'memory': return matrix.dim_memory;
    case 'error-handling': return matrix.dim_errors;
    case 'messages': return matrix.dim_messages;
    case 'events': return matrix.dim_events;
    default: return cellKey;
  }
}

/** LaunchOrb lifecycle glow mapping. */
export const ORB_GLOW_CLASSES: Record<string, string> = {
  idle: '',
  initializing: '',
  analyzing: '',
  resolving: '',
  generating: 'shadow-[0_0_24px_var(--primary)]',
  awaiting_input: 'shadow-[0_0_16px_var(--primary)] animate-glow-breathe',
  draft_ready: 'shadow-[0_0_20px_theme(colors.emerald.400)]',
  testing: '',
  test_complete: 'shadow-[0_0_16px_theme(colors.emerald.400)]',
  promoted: 'shadow-[0_0_20px_theme(colors.emerald.400)] animate-emerald-flash',
  failed: '',
};

// Re-export BuildPhase for convenience
export type { BuildPhase };
