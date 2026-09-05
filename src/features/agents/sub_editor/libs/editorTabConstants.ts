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
  // The `model` save group (useEditorSave) has no tab of its own; its fields
  // are edited under the Design hub, so that is where its dirty dot shows.
  // Pinned by libs/__tests__/tabDirtyDependencies.test.ts against the ids that
  // actually render and register: the previous entries named a tab that no
  // longer renders (`use-cases`) and two groups nothing registers any more
  // (`prompt`, `connectors`), so no dependency in the map could ever fire.
  design: ['model'],
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
 * The `agents.editor.tabs` catalog — one label per tab / save-group id the
 * editor can report as dirty, keyed with underscores.
 *
 * Declared as a CLOSED type rather than taken as `Record<string, string>`: a
 * cast to an open record deletes the generated key type, so an arm missing
 * from every locale is invisible to the compiler AND to the locale-parity
 * gates (which compare locales against each other, and would see the same
 * hole in all fourteen).
 */
export interface EditorTabLabelCatalog {
  use_cases: string;
  prompt: string;
  lab: string;
  connectors: string;
  design: string;
  health: string;
  settings: string;
  model: string;
}

/**
 * Translated label for one dirty-state tab identifier. It is the one place
 * these labels are translated, and until this resolver existed the catalog had
 * zero consumers while three call sites each rendered their own English:
 * TAB_LABELS here, a capitalised id in the editor body, and a hardcoded toast
 * in the switch guard.
 */
export function tabIdLabel(id: string, catalog?: EditorTabLabelCatalog): string {
  const key = id.replace(/-/g, '_');
  // `id` is an open runtime value (any registered dirty-group id), so the
  // lookup is guarded by `in` before the index — that guard is the invariant
  // the keyof assertion rests on. An id the catalog does not carry (e.g.
  // 'notifications', registered by the channels surface) falls through to the
  // English table and then to a humanized id, never to a raw machine token.
  if (catalog && key in catalog) return catalog[key as keyof EditorTabLabelCatalog];
  return TAB_LABELS[id] ?? id.charAt(0).toUpperCase() + id.slice(1);
}

/** Convert a list of tab IDs to human-readable labels. */
export function tabIdsToLabels(ids: string[], catalog?: EditorTabLabelCatalog): string {
  return ids.map((id) => tabIdLabel(id, catalog)).join(', ');
}

/** Check whether a tab should show as dirty, considering both its own
 *  dirty state and any cross-tab dependencies. */
export function isTabDirty(tabId: EditorTab, dirtyTabs: string[]): boolean {
  if (dirtyTabs.includes(tabId)) return true;
  const deps = TAB_DIRTY_DEPENDENCIES[tabId];
  return deps != null && deps.some((dep) => dirtyTabs.includes(dep));
}
