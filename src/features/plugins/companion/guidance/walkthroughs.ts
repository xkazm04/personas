import type { GuidanceWalkthrough } from './types';

/**
 * Registry of Athena's guided walkthroughs, keyed by topic.
 *
 * Steps are authored HERE (not by the model) so the testids, narration, and
 * sequencing are reliable, i18n'd, and testable. Athena only *triggers* a topic
 * (`start_guided_walkthrough { topic }`); the runner walks these steps,
 * gliding the orb and ringing each anchor.
 *
 * To add a walkthrough for another part of the app:
 *   1. Add stable `data-testid`s to the elements you want to point at.
 *   2. Add a `plugins.companion.guide_<topic>_*` narration key per step to
 *      `src/i18n/locales/en.json` and regenerate i18n.
 *   3. Add an entry below and list its topic in `GUIDANCE_TOPICS`.
 *   4. Allow-list the topic in the backend (`dispatcher.rs` GUIDED_TOPICS) so
 *      Athena may trigger it.
 * See docs/features/companion/athena-guided-walkthroughs.md.
 */
export const WALKTHROUGHS: Record<string, GuidanceWalkthrough> = {
  persona_creation: {
    topic: 'persona_creation',
    title: (t) => t.plugins.companion.guide_pc_title,
    steps: [
      {
        id: 'intro',
        narration: (t) => t.plugins.companion.guide_pc_intro,
        orbAnchor: 'center',
      },
      {
        id: 'open',
        narration: (t) => t.plugins.companion.guide_pc_open,
        navigateRoute: 'personas',
        preAction: 'open_build_entry',
        highlightTestId: 'persona-build-entry',
        orbAnchor: 'auto',
      },
      {
        id: 'compose',
        narration: (t) => t.plugins.companion.guide_pc_compose,
        // The sigil's click-to-summon center — where the user describes the persona.
        highlightTestId: 'glyph-compose-summon',
        orbAnchor: 'auto',
      },
      {
        id: 'autonomous',
        narration: (t) => t.plugins.companion.guide_pc_autonomous,
        // The "let AI decide everything" one-shot toggle.
        highlightTestId: 'build-oneshot-toggle',
        orbAnchor: 'auto',
      },
      {
        id: 'outro',
        narration: (t) => t.plugins.companion.guide_pc_outro,
        orbAnchor: 'center',
      },
    ],
    cta: {
      label: (t) => t.plugins.companion.guide_cta_build,
      action: 'build_persona',
    },
  },

  connector_setup: {
    topic: 'connector_setup',
    title: (t) => t.plugins.companion.guide_conn_title,
    steps: [
      {
        id: 'intro',
        narration: (t) => t.plugins.companion.guide_conn_intro,
        orbAnchor: 'center',
      },
      {
        id: 'vault',
        narration: (t) => t.plugins.companion.guide_conn_vault,
        navigateRoute: 'credentials',
        // The Vault route container — always present once `credentials` mounts.
        highlightTestId: 'credential-manager',
        orbAnchor: 'auto',
      },
      {
        id: 'add',
        narration: (t) => t.plugins.companion.guide_conn_add,
        // Drives the vault to its "Add new" view (the vault route is already
        // mounted from the prior step, so the storeBus event has a listener).
        preAction: 'open_credential_add',
        highlightTestId: 'vault-type-picker',
        orbAnchor: 'auto',
        // "Your turn" beat — wait until the user actually picks a connector type
        // (a click inside the picker) before moving to the wrap-up.
        holdForClick: true,
      },
      {
        id: 'outro',
        narration: (t) => t.plugins.companion.guide_conn_outro,
        orbAnchor: 'center',
      },
    ],
    cta: {
      label: (t) => t.plugins.companion.guide_cta_connect,
      action: 'open_connector_add',
    },
  },

  trigger_creation: {
    topic: 'trigger_creation',
    title: (t) => t.plugins.companion.guide_trig_title,
    steps: [
      {
        id: 'intro',
        narration: (t) => t.plugins.companion.guide_trig_intro,
        orbAnchor: 'center',
      },
      {
        id: 'hub',
        narration: (t) => t.plugins.companion.guide_trig_hub,
        navigateRoute: 'events',
        // The Events route container — present on every event-bus sub-tab.
        highlightTestId: 'triggers-page',
        orbAnchor: 'auto',
      },
      {
        id: 'builder',
        narration: (t) => t.plugins.companion.guide_trig_create,
        // Switch to Chain Studio and ring its switchboard (where chains are composed).
        preAction: 'open_trigger_builder',
        highlightTestId: 'studio-switchboard',
        orbAnchor: 'auto',
      },
      {
        id: 'outro',
        narration: (t) => t.plugins.companion.guide_trig_outro,
        orbAnchor: 'center',
      },
    ],
    cta: {
      label: (t) => t.plugins.companion.guide_cta_create_trigger,
      action: 'create_trigger',
    },
  },

  template_adoption: {
    topic: 'template_adoption',
    title: (t) => t.plugins.companion.guide_tmpl_title,
    steps: [
      {
        id: 'intro',
        narration: (t) => t.plugins.companion.guide_tmpl_intro,
        orbAnchor: 'center',
      },
      {
        id: 'gallery',
        narration: (t) => t.plugins.companion.guide_tmpl_gallery,
        navigateRoute: 'design-reviews',
        // The templates gallery route container.
        highlightTestId: 'templates-page',
        orbAnchor: 'auto',
      },
      {
        id: 'adopt',
        narration: (t) => t.plugins.companion.guide_tmpl_adopt,
        // The first card's Adopt button — copies the template into the workspace.
        highlightTestId: 'template-adopt-button',
        orbAnchor: 'auto',
      },
      {
        id: 'outro',
        narration: (t) => t.plugins.companion.guide_tmpl_outro,
        orbAnchor: 'center',
      },
    ],
  },

  incident_triage: {
    topic: 'incident_triage',
    title: (t) => t.plugins.companion.guide_inc_title,
    steps: [
      {
        id: 'intro',
        narration: (t) => t.plugins.companion.guide_inc_intro,
        orbAnchor: 'center',
      },
      {
        id: 'inbox',
        narration: (t) => t.plugins.companion.guide_inc_inbox,
        // Open Overview → Incidents and ring the inbox.
        preAction: 'open_overview_incidents',
        highlightTestId: 'incidents-inbox',
        orbAnchor: 'auto',
      },
      {
        id: 'row',
        narration: (t) => t.plugins.companion.guide_inc_row,
        // The most recent incident row (degrades to narration-only if the
        // inbox is empty — the detail itself opens in a modal, so we don't ring it).
        highlightTestId: 'incident-row',
        orbAnchor: 'auto',
      },
      {
        id: 'outro',
        narration: (t) => t.plugins.companion.guide_inc_outro,
        orbAnchor: 'center',
      },
    ],
  },

  goal_kpi_setup: {
    topic: 'goal_kpi_setup',
    title: (t) => t.plugins.companion.guide_goal_title,
    steps: [
      {
        id: 'intro',
        narration: (t) => t.plugins.companion.guide_goal_intro,
        orbAnchor: 'center',
      },
      {
        id: 'board',
        narration: (t) => t.plugins.companion.guide_goal_board,
        // Teams → Goals → board view.
        preAction: 'open_goals_board',
        highlightTestId: 'goals-page',
        orbAnchor: 'auto',
      },
      {
        id: 'card',
        narration: (t) => t.plugins.companion.guide_goal_card,
        highlightTestId: 'goal-card',
        orbAnchor: 'auto',
      },
      {
        id: 'kpi',
        narration: (t) => t.plugins.companion.guide_goal_kpi,
        // Teams → KPIs dashboard — where a goal is bound to a metric.
        preAction: 'open_kpi_dashboard',
        highlightTestId: 'kpi-dashboard',
        orbAnchor: 'auto',
      },
      {
        id: 'outro',
        narration: (t) => t.plugins.companion.guide_goal_outro,
        orbAnchor: 'center',
      },
    ],
    cta: {
      label: (t) => t.plugins.companion.guide_cta_setup_goal,
      action: 'setup_goal',
    },
  },
};

/** Topics Athena is allowed to trigger. Mirrored by the backend allow-list. */
export const GUIDANCE_TOPICS = Object.keys(WALKTHROUGHS);

/**
 * Sentinel topic for a walkthrough Athena composed at runtime rather than one
 * from the static registry — the `point_at` (single step) and
 * `compose_walkthrough` (multi step) ops. The composed steps live in
 * `companionStore.adHocWalkthrough`; `resolveWalkthrough` returns that when the
 * active topic is this sentinel.
 */
export const ADHOC_TOPIC = '__adhoc__';

export function getWalkthrough(topic: string | null): GuidanceWalkthrough | null {
  if (!topic) return null;
  return WALKTHROUGHS[topic] ?? null;
}

/**
 * Resolve the active walkthrough for the runner + caption: the runtime ad-hoc
 * walkthrough when the topic is the ad-hoc sentinel, otherwise the registry
 * entry. One resolver keeps both consumers in sync without duplicating the
 * registry-vs-adhoc branch.
 */
export function resolveWalkthrough(
  topic: string | null,
  adHoc: GuidanceWalkthrough | null,
): GuidanceWalkthrough | null {
  if (topic === ADHOC_TOPIC) return adHoc;
  return getWalkthrough(topic);
}
