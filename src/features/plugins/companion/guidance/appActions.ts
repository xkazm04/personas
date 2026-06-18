import { useSystemStore } from '@/stores/systemStore';
import { useOverviewStore } from '@/stores/overviewStore';
import { storeBus } from '@/lib/storeBus';
import type { SidebarSection } from '@/lib/types/types';
import type { GuidanceCtaAction, GuidancePreAction } from './types';

/**
 * The small set of app-driving side-effects guidance is allowed to perform —
 * shared by step `preAction`s (run before a step points at its anchor) and
 * walkthrough completion `cta`s (run when the user clicks "do it now"). Kept
 * here as named primitives so both call sites stay in sync and the full set of
 * things guidance can *do* to the app is auditable in one place.
 */

/** Open the persona build studio (the surface `persona_creation` rings). */
export function openBuildStudio() {
  // `isCreatingPersona` is what PersonasPage checks to render UnifiedBuildEntry
  // (vs the persona list / editor).
  const sys = useSystemStore.getState();
  sys.setSidebarSection('personas');
  sys.setIsCreatingPersona(true);
}

/**
 * Drive the Vault to its "Add new" view (the connector type picker). The
 * credential nav lives in a React context, not a global store; `storeBus` is its
 * from-outside-React escape hatch (the onboarding tour uses the same event).
 * Navigating to `credentials` first makes this safe to call from anywhere
 * (idempotent when the route is already mounted).
 */
export function openCredentialAddView() {
  useSystemStore.getState().setSidebarSection('credentials');
  storeBus.emit('tour:navigate-credential-view', { key: 'add-new' });
}

/** Navigate the sidebar to a section — the "Take me there" hand-off for a
 *  `point_at` that rings a nav item. The section comes from the anchor catalog
 *  (`dest`), so it stays bounded to the allow-listed set. */
export function navigateToSection(section: SidebarSection) {
  useSystemStore.getState().setSidebarSection(section);
}

/**
 * Open the Events route on Chain Studio (the `trigger_creation` walkthrough
 * rings its switchboard here). Builder was retired and its routing view folded
 * into Studio's Routes sub-tab; both setters are idempotent.
 */
export function openTriggerBuilder() {
  const sys = useSystemStore.getState();
  sys.setSidebarSection('events');
  sys.setEventBusTab('studio');
}

/**
 * Open Overview on its Incidents sub-tab (the `incident_triage` walkthrough
 * rings the inbox here). The Overview sub-tab lives in its own store slice.
 */
export function openOverviewIncidents() {
  useSystemStore.getState().setSidebarSection('overview');
  useOverviewStore.getState().setOverviewTab('incidents');
}

/**
 * Open the Goals board (Teams → Goals → board view) — the first half of the
 * `goal_kpi_setup` walkthrough. Goals/KPIs are L2 tabs under the Teams route,
 * so we set the section, the teams sub-tab, and the goals view.
 */
export function openGoalsBoard() {
  const sys = useSystemStore.getState();
  sys.setSidebarSection('teams');
  sys.setTeamsTab('goals');
  sys.setGoalsTab('board');
}

/** Open the KPI dashboard (Teams → KPIs) — the second half of `goal_kpi_setup`. */
export function openKpiDashboard() {
  const sys = useSystemStore.getState();
  sys.setSidebarSection('teams');
  sys.setTeamsTab('kpis');
}

/** Run a step's allow-listed pre-action (open a surface so its anchor mounts). */
export function runPreAction(action: GuidancePreAction) {
  switch (action) {
    case 'open_build_entry':
      openBuildStudio();
      break;
    case 'open_credential_add':
      openCredentialAddView();
      break;
    case 'open_trigger_builder':
      openTriggerBuilder();
      break;
    case 'open_overview_incidents':
      openOverviewIncidents();
      break;
    case 'open_goals_board':
      openGoalsBoard();
      break;
    case 'open_kpi_dashboard':
      openKpiDashboard();
      break;
  }
}

/** Run a walkthrough's completion CTA — the "do it now" hand-off into action. */
export function runGuidanceCta(action: GuidanceCtaAction) {
  switch (action) {
    case 'build_persona':
      openBuildStudio();
      break;
    case 'open_connector_add':
      openCredentialAddView();
      break;
    case 'create_trigger':
      openTriggerBuilder();
      break;
    case 'setup_goal':
      openGoalsBoard();
      break;
  }
}
