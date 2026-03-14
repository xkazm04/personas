/**
 * Centralised UI enum constants.
 *
 * Use the `as const` objects for runtime values (switch/match, comparisons)
 * and the derived union types for type annotations. This gives consumers
 * autocomplete, exhaustiveness checking, and single-source refactor safety.
 */

// ---------------------------------------------------------------------------
// Global view mode  (simple | full | dev)
// ---------------------------------------------------------------------------

export const VIEW_MODES = {
  SIMPLE: 'simple',
  FULL: 'full',
  DEV: 'dev',
} as const;

export type ViewMode = (typeof VIEW_MODES)[keyof typeof VIEW_MODES];

/** Ordered cycle used by toggleViewMode: simple → full → dev → simple */
export const VIEW_MODE_CYCLE: readonly ViewMode[] = [
  VIEW_MODES.SIMPLE,
  VIEW_MODES.FULL,
  VIEW_MODES.DEV,
] as const;

/** Default view mode for fresh installs / reset. */
export const DEFAULT_VIEW_MODE: ViewMode = VIEW_MODES.FULL;

// ---------------------------------------------------------------------------
// Component-level view modes
// ---------------------------------------------------------------------------

/** Healing issues panel */
export const HEALING_VIEW_MODES = {
  LIST: 'list',
  TIMELINE: 'timeline',
} as const;

export type HealingViewMode = (typeof HEALING_VIEW_MODES)[keyof typeof HEALING_VIEW_MODES];

/** Schedule timeline */
export const SCHEDULE_VIEW_MODES = {
  TIMELINE: 'timeline',
  GROUPED: 'grouped',
  CALENDAR: 'calendar',
} as const;

export type ScheduleViewMode = (typeof SCHEDULE_VIEW_MODES)[keyof typeof SCHEDULE_VIEW_MODES];

/** Team memory panel */
export const TEAM_MEMORY_VIEW_MODES = {
  LIST: 'list',
  TIMELINE: 'timeline',
  DIFF: 'diff',
} as const;

export type TeamMemoryViewMode = (typeof TEAM_MEMORY_VIEW_MODES)[keyof typeof TEAM_MEMORY_VIEW_MODES];

/** Template gallery */
export const TEMPLATE_VIEW_MODES = {
  LIST: 'list',
  EXPLORE: 'explore',
} as const;

export type TemplateViewMode = (typeof TEMPLATE_VIEW_MODES)[keyof typeof TEMPLATE_VIEW_MODES];

/** Tool selector */
export const TOOL_VIEW_MODES = {
  GRID: 'grid',
  GROUPED: 'grouped',
} as const;

export type ToolViewMode = (typeof TOOL_VIEW_MODES)[keyof typeof TOOL_VIEW_MODES];

/** Persona connectors tab */
export const CONNECTOR_VIEW_MODES = {
  LIST: 'list',
  GRAPH: 'graph',
} as const;

export type ConnectorViewMode = (typeof CONNECTOR_VIEW_MODES)[keyof typeof CONNECTOR_VIEW_MODES];
