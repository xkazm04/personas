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
  // Design hub absorbs Prompt and Connectors save groups (former standalone tabs).
  design: ['prompt', 'connectors'],
};

/** Human-readable labels for dirty-state tab identifiers.
 *  These include internal save-group names (e.g. 'model') that don't
 *  correspond to a visible tab but still appear in dirty/error lists. */
export const TAB_LABELS: Record<string, string> = {
  'use-cases': 'Use Cases',
  prompt: 'Prompt',
  lab: 'Lab',
  connectors: 'Connectors',
  settings: 'Settings',
  assertions: 'Assertions',
  model: 'Model',
};

/**
 * Translated label for one dirty-state tab identifier. `catalog` is the
 * `agents.editor.tabs` map (keyed with underscores, so `use-cases` reads
 * `use_cases`). It is the one place these labels are translated, and until
 * this resolver existed it had zero consumers while three call sites each
 * rendered their own English: TAB_LABELS here, a capitalised id in the editor
 * body, and a hardcoded toast in the switch guard.
 */
export function tabIdLabel(id: string, catalog?: Record<string, string>): string {
  return catalog?.[id.replace(/-/g, '_')] ?? TAB_LABELS[id] ?? id.charAt(0).toUpperCase() + id.slice(1);
}

/** Convert a list of tab IDs to human-readable labels. */
export function tabIdsToLabels(ids: string[], catalog?: Record<string, string>): string {
  return ids.map((id) => tabIdLabel(id, catalog)).join(', ');
}

/** Check whether a tab should show as dirty, considering both its own
 *  dirty state and any cross-tab dependencies. */
export function isTabDirty(tabId: EditorTab, dirtyTabs: string[]): boolean {
  if (dirtyTabs.includes(tabId)) return true;
  const deps = TAB_DIRTY_DEPENDENCIES[tabId];
  return deps != null && deps.some((dep) => dirtyTabs.includes(dep));
}
