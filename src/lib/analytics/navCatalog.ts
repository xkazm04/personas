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
import { NAV_SECTIONS } from '@/lib/navigation/registry';
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

/**
 * All navigation sections, in nav order — DERIVED from the navigation registry
 * (`@/lib/navigation/registry`) so analytics coverage can never silently omit a
 * section (or invent one that no longer exists). Every reachability class is
 * tracked (sidebar + overlay-only like Schedules + any hidden), because a
 * user can visit any of them.
 */
export const SECTIONS: readonly SidebarSection[] = NAV_SECTIONS.map((e) => e.id);

// -- Per-dimension value sets (mirror the unions in types.ts) ----------------
// Each set is declared as a `Record<Union, true>` and unwrapped by `exact()`.
// Unlike the previous `satisfies readonly X[]` guards — which accept SUBSETS,
// and therefore missed `mastermind` and `missions` when those tabs shipped —
// a Record requires EVERY union member as a key, so both an omission and a
// stale extra are compile errors.

const exact = <T extends string>(map: Record<T, true>): readonly T[] => Object.keys(map) as T[];

const HOME_TABS = exact<HomeTab>({ welcome: true, cockpit: true, roadmap: true, 'system-check': true, learning: true });
// `observability` was removed from OverviewTab — it had no OverviewPage router
// case (the ObservabilityDashboard component is mounted elsewhere), so tracking
// it inflated the "ignored" denominator with an unreachable tab.
const OVERVIEW_TABS = exact<OverviewTab>({ home: true, incidents: true, executions: true, 'manual-review': true, messages: true, events: true, knowledge: true, sla: true, health: true, leaderboard: true, director: true, certification: true });
const TEAMS_TABS = exact<TeamsTab>({ workspace: true, goals: true, kpis: true, factory: true, projects: true, lifecycle: true, competition: true, mastermind: true });
const GOALS_TABS = exact<GoalsTab>({ board: true, timeline: true, progress: true, missions: true });
const TEMPLATE_TABS = exact<TemplateTab>({ n8n: true, generated: true, explore: true, recipes: true, presets: true });
const AGENT_TABS = exact<AgentTab>({ all: true, create: true, groups: true, cloud: true });
const EDITOR_TABS = exact<EditorTab>({ activity: true, matrix: true, 'use-cases': true, lab: true, settings: true, chat: true, design: true, assertions: true });
// `parameters` was missing from the old subset-tolerant guard too — the exact
// Record caught it on conversion (third omission after mastermind + missions).
const DESIGN_SUB_TABS = exact<DesignSubTab>({ 'use-cases': true, prompt: true, parameters: true, connectors: true, triggers: true, messaging: true, automations: true });
const CLOUD_TABS = exact<CloudTab>({ cloud: true, gitlab: true, unified: true });
const SETTINGS_TABS = exact<SettingsTab>({ account: true, appearance: true, notifications: true, radio: true, engine: true, byom: true, portability: true, network: true, admin: true, 'api-keys': true, history: true, limits: true });
const PLUGIN_TABS = exact<PluginTab>({ browse: true, 'dev-tools': true, artist: true, 'obsidian-brain': true, 'research-lab': true, drive: true, twin: true, companion: true, scraper: true });
const DEV_TOOLS_TABS = exact<DevToolsTab>({ overview: true, 'llm-overview': true, 'context-map': true, 'idea-scanner': true, 'idea-triage': true, 'task-runner': true, fleet: true, workspaces: true, skills: true });
const EVENT_BUS_TABS = exact<EventBusTab>({ studio: true, shared: true, 'live-stream': true, 'rate-limits': true, test: true, 'smee-relay': true, 'cloud-webhooks': true, 'dead-letter': true });
const RESEARCH_LAB_TABS = exact<ResearchLabTab>({ dashboard: true, projects: true, literature: true, hypotheses: true, experiments: true, findings: true, reports: true, graph: true });

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
