import type { EditorTab } from '@/lib/types/types';

/**
 * Cross-tab dirty dependency map.
 *
 * When a source tab (value) is dirty, the dependent tab (key) should also
 * appear dirty in the tab bar. This makes implicit save-ordering visible:
 * e.g. changing the model config affects which use-case results are valid,
 * so the use-cases tab shows a dirty badge when the model tab has unsaved
 * changes.
 *
 * To add a new dependency, append the source tab ID to the array for the
 * dependent tab. Only add entries where a genuine data dependency exists.
 */
export const TAB_DIRTY_DEPENDENCIES: Partial<Record<EditorTab, string[]>> = {
  // Model config changes invalidate use-case test results
  'use-cases': ['model'],
};

/** Human-readable labels for dirty-state tab identifiers.
 *  These include internal save-group names (e.g. 'model') that don't
 *  correspond to a visible tab but still appear in dirty/error lists. */
export const TAB_LABELS: Record<string, string> = {
  'use-cases': 'Use Cases',
  prompt: 'Prompt',
  lab: 'Lab',
  connectors: 'Connectors',
  design: 'Design',
  health: 'Health',
  settings: 'Settings',
  model: 'Model',
};

/** Convert a list of tab IDs to human-readable labels. */
export function tabIdsToLabels(ids: string[]): string {
  return ids.map((id) => TAB_LABELS[id] ?? id).join(', ');
}

/** Check whether a tab should show as dirty, considering both its own
 *  dirty state and any cross-tab dependencies. */
export function isTabDirty(tabId: EditorTab, dirtyTabs: string[]): boolean {
  if (dirtyTabs.includes(tabId)) return true;
  const deps = TAB_DIRTY_DEPENDENCIES[tabId];
  return deps != null && deps.some((dep) => dirtyTabs.includes(dep));
}
