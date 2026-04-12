import type { BuildPhase } from '@/lib/types/buildTypes';

/** Human-readable cell key labels. */
export const CELL_FRIENDLY_NAMES: Record<string, string> = {
  'use-cases': 'Tasks',
  'connectors': 'Apps & Services',
  'triggers': 'When It Runs',
  'human-review': 'Human Review',
  'memory': 'Memory',
  'error-handling': 'Error Handling',
  'messages': 'Messages',
  'events': 'Events',
};

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
