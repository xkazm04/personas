/**
 * The one registry of `persona_events.source_type` — every value the backend
 * actually emits, with its glyph, its origin group and its translated label.
 *
 * ## Why this file exists
 *
 * Until 2026-10-05 the knowledge was split in two and complete in neither:
 * `eventLogColumns.tsx` held a 15-key icon map and `EventLogList.tsx` held a
 * separate 4-key label map. A source in neither fell through to a `HelpCircle`
 * question mark plus a de-underscored raw token in a `title` tooltip — and the
 * cell rendered the icon ONLY, so the token was invisible without a hover.
 *
 * Measured against the live database (164 `persona_events` rows, 2026-10-05):
 * **zero rows had an empty `source_type`** — every row had one — yet the three
 * biggest sources in the table were all absent from the icon map:
 * `audit_incident` (54), `autopilot` (45) and `system_op` (9). That is 108 rows,
 * **about two thirds of the table**, each showing a question mark in a column
 * headed "Source". The reported symptom ("a lot of events with no source") was
 * real; the mechanism was a coverage gap in the renderer, not a data gap.
 *
 * `trigger` — the bare form published by the scheduler and the trigger
 * commands, as distinct from the `trigger:<kind>` prefixed form — was missing
 * the same way, and a surprising amount of the engine (`chain`, `app_master`,
 * `context_rule`, `sla_monitor`, `fired_alerts`, `scraper`, `smee_relay`,
 * `composite`, `polling`, `mcp`, …) had never been covered at all.
 *
 * ## The contract
 *
 * `SOURCE_REGISTRY` is enumerated from the Rust **emit sites**, not from the
 * rows one machine happens to hold, so a source that has not fired yet does
 * not become the next question mark. Each entry cites its emitter. When a new
 * `source_type` is introduced in `src-tauri/**`, add it here in the same change
 * — `tokenLabel` already logs a DEV console warning for an unregistered token,
 * and `resolveEventSource` renders a loud warning glyph rather than a plausible
 * neutral one.
 *
 * ## Origin, and what it may NOT claim
 *
 * `origin` answers "who acted?" and it is the colour axis of the Source column:
 * four meaningful tones replace the eleven decorative ones the old icon map
 * carried, now that the cell also prints the label (identity is in the text, so
 * colour is free to carry the one thing text cannot show at a glance).
 *
 * It is deliberately NOT a flattering summary. `system_op` and `audit_incident`
 * look like "my activity" from the outside — a context scan is often started by
 * the Context Map "Plan update" button, and an incident is often resolved by a
 * person — but the emitted row carries **no origin flag**, and the same source
 * is also published by the background loop and by Athena. Labelling either of
 * them as a user action would be a claim the data does not support, so both are
 * `app`. Only sources whose *only* producer is a human act are `you`.
 */

import {
  AlertTriangle, Antenna, BellRing, Bot, Brain, CalendarClock, Clipboard,
  ClipboardCheck, CloudCog, CloudUpload, Cog, Crown, FlaskConical, FolderSync,
  GitMerge, Globe, HardDrive, HeartPulse, KeyRound, Lightbulb, Link2,
  MessagesSquare, MousePointerClick, Navigation, Plug, RefreshCw, Rocket,
  ScrollText, Share, Share2, ShieldAlert, Timer, User, UserCheck, Webhook,
  Workflow, Wrench,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { Translations } from '@/i18n/en';
import { tokenLabel } from '@/i18n/tokenMaps';

/** Who acted. The Source column's colour axis. */
export type EventSourceOrigin = 'you' | 'agent' | 'app' | 'external';

/** One tone per origin — not per source. See the file header. */
export const ORIGIN_TONE: Record<EventSourceOrigin, string> = {
  // Gate 5: a thing waiting on the operator reads info-blue, never the pink
  // human role.
  you: 'text-sky-400',
  // The established persona violet (the old map's `persona` tone).
  agent: 'text-violet-400',
  // Brand indigo: the platform acting as itself.
  app: 'text-primary',
  external: 'text-emerald-400',
};

interface SourceEntry {
  icon: LucideIcon;
  origin: EventSourceOrigin;
}

/**
 * Every `source_type` emitted by production code, keyed by the exact token.
 * The two prefixed families (`persona:<id>`, `trigger:<kind>`) resolve to their
 * base entry in {@link resolveSourceKey}.
 */
export const SOURCE_REGISTRY: Record<string, SourceEntry> = {
  // ── A person acted ─────────────────────────────────────────────────────
  /** Reserved for a directly operator-published event. */
  user: { icon: User, origin: 'you' },
  /** commands/design/reviews.rs — a human submitted a design review. */
  manual_review: { icon: UserCheck, origin: 'you' },
  /** engine/app_focus.rs — the Companion sensing which app you are in. */
  app_focus: { icon: MousePointerClick, origin: 'you' },
  /** engine/clipboard_monitor.rs — something you copied. */
  clipboard: { icon: Clipboard, origin: 'you' },

  // ── An agent acted ─────────────────────────────────────────────────────
  /** engine/bus.rs + engine/dispatch.rs, as `persona:<id|name>`. */
  persona: { icon: Bot, origin: 'agent' },
  /** commands/infrastructure/overnight.rs — unattended overnight runs. */
  autopilot: { icon: Navigation, origin: 'agent' },
  /** engine/app_master.rs — the project's App Master. */
  app_master: { icon: Crown, origin: 'agent' },
  /** db/chain.rs — one agent handing off to the next. */
  chain: { icon: Link2, origin: 'agent' },
  /** engine/composite.rs — a composite trigger's combined verdict. */
  composite: { icon: GitMerge, origin: 'agent' },
  /** commands/teams/team_channel.rs — a channel leader's per-turn verdict. */
  team_channel: { icon: MessagesSquare, origin: 'agent' },

  // ── The app acted ──────────────────────────────────────────────────────
  /** engine/auto_rollback.rs. */
  system: { icon: Cog, origin: 'app' },
  /**
   * engine/system_ops.rs — a backend operation that is not a persona run
   * (today: `context_scan`). Started by a button, by a Chain Studio
   * automation or by a due schedule; the row does not say which.
   */
  system_op: { icon: Wrench, origin: 'app' },
  /** engine/background/scheduler.rs — a due schedule tick. */
  scheduler: { icon: CalendarClock, origin: 'app' },
  /** The bare form: commands/execution/scheduler.rs, commands/tools/triggers.rs. */
  trigger: { icon: Workflow, origin: 'app' },
  /** The `trigger:<kind>` family, and the dev seed's own token. */
  trigger_engine: { icon: Workflow, origin: 'app' },
  /**
   * commands/execution/audit_incidents.rs — the incidents inbox raising or
   * resolving one. Resolved by a person OR by Athena; the row does not say.
   */
  audit_incident: { icon: ShieldAlert, origin: 'app' },
  /** Dev seed (commands/communication/mock_seed.rs). */
  health_monitor: { icon: HeartPulse, origin: 'app' },
  /** engine/sla_breach.rs. */
  sla_monitor: { icon: Timer, origin: 'app' },
  /** commands/execution/alert_evaluator.rs. */
  fired_alerts: { icon: BellRing, origin: 'app' },
  /** Dev seed. */
  memory_engine: { icon: Brain, origin: 'app' },
  /** Dev seed. */
  review_pipeline: { icon: ClipboardCheck, origin: 'app' },
  /** Dev seed. */
  cloud_deploy: { icon: CloudUpload, origin: 'app' },
  /** Dev seed. */
  vault: { icon: KeyRound, origin: 'app' },
  /** engine/context_rules.rs. */
  context_rule: { icon: ScrollText, origin: 'app' },
  /** db/repos/dev/ideas.rs — a scan finding promoted to an idea. */
  findings: { icon: Lightbulb, origin: 'app' },
  /** engine/polling.rs. */
  polling: { icon: RefreshCw, origin: 'app' },
  /**
   * hooks/realtime/emitDeploymentEvent.ts — a LOCAL-ONLY row the renderer
   * synthesizes; nothing persists it (see `hasServerOrderingKey`).
   */
  deployment: { icon: Rocket, origin: 'app' },
  /** Test fixtures only (db/src/cdc.rs, engine/src/bus.rs, …). */
  test: { icon: FlaskConical, origin: 'app' },

  // ── Came from outside ──────────────────────────────────────────────────
  /** engine/webhook.rs. */
  webhook: { icon: Webhook, origin: 'external' },
  /** engine/cloud_webhook_relay.rs. */
  cloud_webhook: { icon: CloudCog, origin: 'external' },
  /** engine/smee_relay.rs. */
  smee_relay: { icon: Antenna, origin: 'external' },
  /** engine/scraper.rs. */
  scraper: { icon: Globe, origin: 'external' },
  /** engine/file_watcher.rs. */
  file_watcher: { icon: FolderSync, origin: 'external' },
  /** commands/drive/mod.rs (`DRIVE_SOURCE_TYPE`). */
  local_drive: { icon: HardDrive, origin: 'external' },
  /** engine/shared_event_relay.rs — a peer's shared catalog. */
  shared_catalog: { icon: Share2, origin: 'external' },
  /** engine/shared_event_local_relay.rs — this device's own relay. */
  shared_catalog_local: { icon: Share, origin: 'external' },
  /** mcp_server/tools.rs — an outside client calling one of our tools. */
  mcp: { icon: Plug, origin: 'external' },
};

/**
 * Collapse a raw `source_type` onto its registry key.
 *
 * `persona:<id|name>` and `trigger:<kind>` are open-ended families — the suffix
 * is an id, not a kind — so both fold onto their base entry. Returns `null`
 * when the token is genuinely unregistered, which is the only path to the
 * warning glyph.
 */
export function resolveSourceKey(rawSourceType: string): string | null {
  const raw = rawSourceType.trim();
  if (!raw) return null;
  if (raw.startsWith('persona:')) return 'persona';
  if (raw.startsWith('trigger:')) return 'trigger_engine';
  return raw in SOURCE_REGISTRY ? raw : null;
}

export interface ResolvedEventSource {
  /** The glyph for the cell. */
  icon: LucideIcon;
  /** Tailwind text colour — the origin's tone, or warning for an unknown. */
  tone: string;
  /** The translated short label printed in the cell. Never empty. */
  label: string;
  /** The translated origin phrase, for the cell's tooltip. */
  originLabel: string;
  /** False when the token was not in the registry — a defect, not a state. */
  known: boolean;
}

/**
 * Resolve a raw `source_type` to everything the Source cell needs.
 *
 * An unregistered token does NOT get a plausible neutral glyph: it gets a
 * warning triangle in the warning tone, and the raw token itself as the label.
 * That keeps the owner's rule — "source should never be empty in the table" —
 * true even in the failure case, while making the failure visibly a failure
 * instead of a valid-looking state.
 */
export function resolveEventSource(t: Translations, rawSourceType: string): ResolvedEventSource {
  const key = resolveSourceKey(rawSourceType);
  if (!key) {
    const raw = rawSourceType.trim();
    return {
      icon: AlertTriangle,
      tone: 'text-status-warning',
      label: raw || t.overview.events.source_unknown,
      originLabel: t.overview.events.source_unknown,
      known: false,
    };
  }
  const entry = SOURCE_REGISTRY[key]!;
  return {
    icon: entry.icon,
    tone: ORIGIN_TONE[entry.origin],
    label: tokenLabel(t, 'event_source', key),
    originLabel: tokenLabel(t, 'event_origin', entry.origin),
    known: true,
  };
}

/** The Source column's filter label for one raw `source_type` value. */
export function eventSourceLabel(t: Translations, rawSourceType: string): string {
  const key = resolveSourceKey(rawSourceType);
  if (!key) return rawSourceType.trim() || t.overview.events.source_unknown;
  return tokenLabel(t, 'event_source', key);
}
