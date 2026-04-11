import type { BuildPhase } from '@/lib/types/buildTypes';

/** Human-readable labels for build phases. */
export const BUILD_PHASE_LABELS: Record<string, string> = {
  initializing: 'Preparing build...',
  analyzing: 'Analyzing your intent...',
  resolving: 'Building agent dimensions...',
  awaiting_input: 'Waiting for your input...',
  draft_ready: 'Draft ready for review',
  testing: 'Testing agent...',
  test_complete: 'Test complete',
  promoted: 'Agent promoted',
  failed: 'Build failed',
};

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

/** Phase sub-text descriptions. */
export const PHASE_SUBTEXT: Record<string, string> = {
  analyzing: 'Understanding your intent...',
  resolving: 'Building agent configuration...',
  awaiting_input: 'Your input is needed — click a highlighted dimension',
  draft_ready: 'All dimensions resolved — ready for testing',
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
