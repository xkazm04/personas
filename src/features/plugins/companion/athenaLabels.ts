/**
 * Athena label helpers — single source of truth for translating the
 * machine identifiers Athena's grammar uses (approval action slugs,
 * proactive trigger kinds, connector capabilities, brain memory kinds)
 * into human-readable labels for chat surfaces.
 *
 * Every helper takes the translation `t` and returns a string. None of
 * these should ever return the raw slug — the fallback path uses the
 * `*_unknown_fallback` keys so users see "Athena's proposal" instead of
 * "fleet_send_input" if a backend update adds a new slug ahead of the
 * frontend.
 *
 * Adding a new slug:
 *   1. Add a key to `plugins.companion.<group>_label_<slug>` in en.json.
 *   2. Add the case here.
 *   3. No-op in the consuming component — it calls the helper.
 */
import type { useTranslation } from '@/i18n/useTranslation';

type T = ReturnType<typeof useTranslation>['t'];

/**
 * Humanize an approval action slug.
 *
 * Returns `t.plugins.companion.action_label_<slug>` if known, otherwise
 * a title-cased synth ("fleet_send_input" → "Fleet Send Input") so an
 * unknown action still reads as English-ish rather than identifier-like.
 * The slug is also surfaced in a dim secondary line per usage site so
 * developers can still see what the backend sent.
 */
export function actionLabel(t: T, action: string): string {
  const c = t.plugins.companion;
  switch (action) {
    case 'run_persona':
      return c.action_label_run_persona;
    case 'resolve_human_review':
      return c.action_label_resolve_human_review;
    case 'update_identity':
      return c.action_label_update_identity;
    case 'write_fact':
      return c.action_label_write_fact;
    case 'delete_fact':
      return c.action_label_delete_fact;
    case 'write_procedural':
      return c.action_label_write_procedural;
    case 'delete_procedural':
      return c.action_label_delete_procedural;
    case 'write_goal':
      return c.action_label_write_goal;
    case 'update_goal_status':
      return c.action_label_update_goal_status;
    case 'delete_goal':
      return c.action_label_delete_goal;
    case 'write_ritual':
      return c.action_label_write_ritual;
    case 'set_ritual_active':
      return c.action_label_set_ritual_active;
    case 'delete_ritual':
      return c.action_label_delete_ritual;
    case 'write_backlog_item':
      return c.action_label_write_backlog_item;
    case 'resolve_backlog_item':
      return c.action_label_resolve_backlog_item;
    case 'prefill_persona_create':
      return c.action_label_prefill_persona_create;
    case 'build_oneshot':
      return c.action_label_build_oneshot;
    case 'run_arena':
      return c.action_label_run_arena;
    case 'compose_dashboard':
      return c.action_label_compose_dashboard;
    case 'compose_cockpit':
      return c.action_label_compose_cockpit;
    case 'register_project':
      return c.action_label_register_project;
    case 'enqueue_dev_job':
      return c.action_label_enqueue_dev_job;
    case 'schedule_proactive':
      return c.action_label_schedule_proactive;
    case 'fleet_send_input':
      return c.action_label_fleet_send_input;
    case 'fleet_broadcast':
      return c.action_label_fleet_broadcast;
    case 'fleet_kill':
      return c.action_label_fleet_kill;
    case 'fleet_spawn':
      return c.action_label_fleet_spawn;
    case 'fleet_dispatch':
      return c.action_label_fleet_dispatch;
    case 'fleet_intervene':
      return c.action_label_fleet_intervene;
    case 'fleet_redirect_op':
      return c.action_label_fleet_redirect_op;
    default:
      return titleCase(action);
  }
}

/**
 * Humanize a proactive trigger kind. Used by the ProactiveCard meta line
 * ("Athena reached out · {triggerLabel}") so users see "fleet operation
 * done" instead of "fleet_op_completed".
 */
export function triggerKindLabel(t: T, kind: string): string {
  const c = t.plugins.companion;
  switch (kind) {
    case 'goal_target_approaching':
      return c.proactive_kind_goal;
    case 'backlog_aging':
      return c.proactive_kind_backlog;
    case 'cadence_due':
      return c.proactive_kind_cadence;
    case 'on_this_day':
      return c.proactive_kind_on_this_day;
    case 'athena_scheduled':
      return c.proactive_kind_athena_scheduled;
    case 'ambient_match':
      return c.proactive_kind_ambient_match;
    case 'fleet_failed':
      return c.proactive_kind_fleet_failed;
    case 'fleet_awaiting':
      return c.proactive_kind_fleet_awaiting;
    case 'fleet_stale':
      return c.proactive_kind_fleet_stale;
    case 'fleet_stuck_dispatched':
      return c.proactive_kind_fleet_stuck_dispatched;
    case 'fleet_op_completed':
      return c.proactive_kind_fleet_op_completed;
    case 'incident_blocker':
      return c.proactive_kind_incident_blocker;
    case 'execution_review':
      return c.proactive_kind_execution_review;
    case 'message_digest':
      return c.proactive_kind_message_digest;
    default:
      return c.proactive_kind_unknown;
  }
}

/**
 * Humanize a connector capability slug (e.g. `list_issues` → "Recent issues").
 * The capability registry is small (one match arm per service capability
 * in the Rust dispatcher) so each known one gets a dedicated label.
 */
export function capabilityLabel(t: T, capability: string): string {
  const c = t.plugins.companion;
  switch (capability) {
    case 'list_issues':
      return c.capability_label_list_issues;
    case 'get_issue':
      return c.capability_label_get_issue;
    case 'list_repos':
      return c.capability_label_list_repos;
    case 'list_open_prs':
      return c.capability_label_list_open_prs;
    case 'list_channels':
      return c.capability_label_list_channels;
    case 'list_recent_threads':
      return c.capability_label_list_recent_threads;
    default:
      return titleCase(capability);
  }
}

/**
 * Humanize a connector service-type slug. Brand names (GitHub, Slack,
 * Sentry, Gmail) are preserved via i18n keys because case + spacing
 * matters — "GitHub" not "Github", "Google Workspace" not "google_workspace".
 */
export function connectorDisplayName(t: T, serviceType: string): string {
  const c = t.plugins.companion;
  switch (serviceType.toLowerCase()) {
    case 'sentry':
      return c.connector_label_sentry;
    case 'github':
      return c.connector_label_github;
    case 'gmail':
      return c.connector_label_gmail;
    case 'google_workspace':
      return c.connector_label_google_workspace;
    case 'slack':
      return c.connector_label_slack;
    default:
      return titleCase(serviceType);
  }
}

/**
 * Title-case a snake_case slug for the "unknown" fallback paths.
 *   `fleet_send_input` → "Fleet Send Input"
 *   `claude-opus-4-7` → "Claude Opus 4 7"
 *
 * Not for known slugs — those should have explicit i18n labels above.
 */
export function titleCase(slug: string): string {
  if (!slug) return '';
  return slug
    .replace(/[_-]+/g, ' ')
    .trim()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * Strip Athena's reply-shaping directives (`OP:`, `QR:`, `TTS:`, raw
 * `{"op":` lines) from streaming text so the user never sees raw JSON
 * lines flash before the backend's dispatcher finalizes the cleaned
 * version. The dispatcher does the same strip server-side on persist;
 * this is purely a display filter on the in-flight bubble.
 *
 * Pure function. Returns a new string.
 */
export function stripModelDirectives(text: string): string {
  if (!text) return text;
  const lines = text.split('\n');
  const kept: string[] = [];
  for (const line of lines) {
    const trimmed = line.trimStart();
    if (
      trimmed.startsWith('OP:') ||
      trimmed.startsWith('QR:') ||
      trimmed.startsWith('TTS:') ||
      trimmed.startsWith('{"op"')
    ) {
      continue;
    }
    kept.push(line);
  }
  // Trim trailing whitespace introduced by the strip without disturbing
  // intentional paragraph breaks in the middle.
  let out = kept.join('\n');
  while (out.endsWith('\n') || out.endsWith(' ')) {
    out = out.slice(0, -1);
  }
  return out;
}
