/**
 * Declarative navigation catalog — the single source of truth for every
 * trackable UI surface (sidebar sections + per-section tab dimensions).
 *
 * This is the FOUNDATION the usage-analytics layer is built on. Driving
 * instrumentation off this catalog (instead of a hand-maintained map) gives
 * two guarantees the previous ad-hoc `TAB_SECTION_MAP` could not:
 *
 *   1. Completeness — every section and tab dimension is tracked, so coverage
 *      can't silently drift when a new tab is added to the store.
 *   2. "Ignored" is computable — because the catalog enumerates the FULL set
 *      of sections/tabs, the session summary can report what was *never*
 *      visited (full catalog − visited set), not just what was.
 *
 * Keep the value arrays in sync with the unions in `@/lib/types/types`. The
 * `satisfies` guards below fail the typecheck if a value is mistyped; the unit
 * test (`summary.test.ts`) guards structural invariants (unique keys, non-empty
 * value sets, sections drawn from `SECTIONS`).
 */
import type {
  SidebarSection,
  HomeTab,
  TeamsTab,
  GoalsTab,
  EditorTab,
  DesignSubTab,
  OverviewTab,
  TemplateTab,
  CloudTab,
  SettingsTab,
  DevToolsTab,
  AgentTab,
  PluginTab,
  ResearchLabTab,
  EventBusTab,
} from '@/lib/types/types';

/** Zustand store that owns a given navigation field — controls how we subscribe. */
export type NavStore = 'system' | 'overview';

export interface TabDimension {
  /** Zustand state field name (e.g. "homeTab"). */
  readonly key: string;
  /** Store that owns the field. */
  readonly store: NavStore;
  /** SidebarSection this dimension belongs to (best-effort grouping). */
  readonly section: SidebarSection;
  /** Complete set of possible values — the denominator for "ignored". */
  readonly values: readonly string[];
}

/** All sidebar sections, in nav order. Mirrors `SidebarSection`. */
export const SECTIONS = [
  'home',
  'overview',
  'teams',
  'personas',
  'events',
  'credentials',
  'design-reviews',
  'plugins',
  'schedules',
  'settings',
] as const satisfies readonly SidebarSection[];

// -- Per-dimension value sets (mirror the unions in types.ts) ----------------
// Declared separately so each gets its own `satisfies` drift guard.

const HOME_TABS = ['welcome', 'cockpit', 'roadmap', 'system-check', 'learning'] as const satisfies readonly HomeTab[];
const OVERVIEW_TABS = ['home', 'incidents', 'executions', 'manual-review', 'messages', 'events', 'knowledge', 'sla', 'health', 'observability', 'leaderboard', 'director', 'certification'] as const satisfies readonly OverviewTab[];
const TEAMS_TABS = ['workspace', 'goals'] as const satisfies readonly TeamsTab[];
const GOALS_TABS = ['board', 'map', 'timeline'] as const satisfies readonly GoalsTab[];
const TEMPLATE_TABS = ['n8n', 'generated', 'recipes', 'presets'] as const satisfies readonly TemplateTab[];
const AGENT_TABS = ['all', 'create', 'groups', 'cloud'] as const satisfies readonly AgentTab[];
const EDITOR_TABS = ['activity', 'matrix', 'use-cases', 'lab', 'settings', 'chat', 'design', 'assertions'] as const satisfies readonly EditorTab[];
const DESIGN_SUB_TABS = ['use-cases', 'prompt', 'connectors', 'triggers', 'messaging', 'automations'] as const satisfies readonly DesignSubTab[];
const CLOUD_TABS = ['cloud', 'gitlab', 'unified'] as const satisfies readonly CloudTab[];
const SETTINGS_TABS = ['account', 'appearance', 'notifications', 'engine', 'byom', 'portability', 'network', 'admin', 'config', 'api-keys', 'history', 'limits'] as const satisfies readonly SettingsTab[];
const PLUGIN_TABS = ['browse', 'dev-tools', 'artist', 'obsidian-brain', 'research-lab', 'drive', 'twin', 'companion'] as const satisfies readonly PluginTab[];
const DEV_TOOLS_TABS = ['overview', 'projects', 'goals', 'context-map', 'idea-scanner', 'idea-triage', 'task-runner', 'lifecycle', 'skills', 'fleet'] as const satisfies readonly DevToolsTab[];
const EVENT_BUS_TABS = ['builder', 'studio', 'shared', 'live-stream', 'rate-limits', 'test', 'smee-relay', 'cloud-webhooks', 'dead-letter'] as const satisfies readonly EventBusTab[];
const RESEARCH_LAB_TABS = ['dashboard', 'projects', 'literature', 'hypotheses', 'experiments', 'findings', 'reports', 'graph'] as const satisfies readonly ResearchLabTab[];

/**
 * Every store-backed tab dimension. `section` is best-effort attribution for
 * grouping in dashboards; it does not affect section visit/ignored accuracy
 * (sections are tracked independently via `sidebarSection`). Counts are keyed
 * by `<dimension key>:<value>` so dimensions that share a value within the same
 * section (e.g. `editorTab` and `designSubTab` both have `use-cases`) never
 * collide.
 */
export const TAB_DIMENSIONS: readonly TabDimension[] = [
  { key: 'homeTab', store: 'system', section: 'home', values: HOME_TABS },
  { key: 'overviewTab', store: 'overview', section: 'overview', values: OVERVIEW_TABS },
  { key: 'teamsTab', store: 'system', section: 'teams', values: TEAMS_TABS },
  { key: 'goalsTab', store: 'system', section: 'teams', values: GOALS_TABS },
  { key: 'templateTab', store: 'system', section: 'design-reviews', values: TEMPLATE_TABS },
  { key: 'agentTab', store: 'system', section: 'personas', values: AGENT_TABS },
  { key: 'editorTab', store: 'system', section: 'personas', values: EDITOR_TABS },
  { key: 'designSubTab', store: 'system', section: 'personas', values: DESIGN_SUB_TABS },
  { key: 'cloudTab', store: 'system', section: 'personas', values: CLOUD_TABS },
  { key: 'settingsTab', store: 'system', section: 'settings', values: SETTINGS_TABS },
  { key: 'pluginTab', store: 'system', section: 'plugins', values: PLUGIN_TABS },
  { key: 'devToolsTab', store: 'system', section: 'plugins', values: DEV_TOOLS_TABS },
  { key: 'eventBusTab', store: 'system', section: 'events', values: EVENT_BUS_TABS },
  { key: 'researchLabTab', store: 'system', section: 'plugins', values: RESEARCH_LAB_TABS },
];

/** Tab dimensions owned by the main system store (subscribed eagerly). */
export const SYSTEM_TAB_DIMENSIONS: readonly TabDimension[] = TAB_DIMENSIONS.filter((d) => d.store === 'system');

/** Tab dimensions owned by the lazy overview store (subscribed on first visit). */
export const OVERVIEW_TAB_DIMENSIONS: readonly TabDimension[] = TAB_DIMENSIONS.filter((d) => d.store === 'overview');
