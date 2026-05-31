/**
 * Fleet ↔ Athena fusion helpers — attention levels for terminal tiles and
 * the mapping from Athena's pending approvals to the session they target.
 *
 * Pure functions (no React) so both the grid overlay and the single pane can
 * share them, and so they're trivially testable.
 */
import type { FleetSession } from '@/lib/bindings/FleetSession';
import type { PendingApproval } from '@/api/companion';

/** Visual attention a session warrants. `none` → use the base border. */
export type FleetAttention = 'waiting' | 'stale' | 'failed' | 'none';

/**
 * True when a session never attached a Claude agent: no `claude_session_id`
 * ever bound and it's already gone stale. Asking Athena to "unblock" it is
 * futile — there's no live agent on the other end to type into — so the right
 * move is kill + retry (often the folder needs Claude Code's trust approval),
 * not a `fleet_send_input` nudge. Mirrors the Rust `is_never_attached` verdict.
 */
export function isNeverAttached(s: Pick<FleetSession, 'state' | 'claudeSessionId'>): boolean {
  return s.claudeSessionId == null && s.state === 'stale';
}

/** Classify a session by how much it wants the operator's (or Athena's) eyes. */
export function sessionAttention(
  s: Pick<FleetSession, 'state' | 'exitCode' | 'claudeSessionId'>,
): FleetAttention {
  switch (s.state) {
    case 'awaiting_input':
      return 'waiting';
    case 'stale':
      // Never-attached → 'failed' (distinct red), not the amber "stale" that
      // invites an Athena nudge — there's no agent to nudge.
      return isNeverAttached(s) ? 'failed' : 'stale';
    case 'exited':
      return s.exitCode != null && s.exitCode !== 0 ? 'failed' : 'none';
    default:
      return 'none';
  }
}

/** CSS class (from globals.css) for an attention level, or '' for none. */
export function attentionClass(a: FleetAttention): string {
  switch (a) {
    case 'waiting':
      return 'fleet-attn-waiting';
    case 'stale':
      return 'fleet-attn-stale';
    case 'failed':
      return 'fleet-attn-failed';
    default:
      return '';
  }
}

/**
 * Athena approval actions that write to / target a single session's PTY.
 * These are the ones we surface *on the tile* (vs. the generic Needs-You
 * banner) so the suggestion lands next to the terminal it's about.
 */
const TILE_ACTIONS = new Set(['fleet_send_input', 'fleet_intervene']);

/** A pending Athena proposal scoped to one fleet session. */
export interface FleetTileApproval {
  id: string;
  /** `fleet_send_input` | `fleet_intervene` */
  action: string;
  rationale: string;
  /** The exact text Athena proposes to type into the session (may be ''). */
  text: string;
}

/**
 * Filter the companion's pending approvals down to PTY-write proposals
 * targeting `sessionId`, parsing each approval's `paramsJson` for the
 * session id + the proposed text (`text` for send_input, `message` for
 * intervene). Malformed payloads are skipped silently.
 */
export function approvalsForSession(
  approvals: PendingApproval[],
  sessionId: string,
): FleetTileApproval[] {
  const out: FleetTileApproval[] = [];
  for (const a of approvals) {
    if (!TILE_ACTIONS.has(a.action)) continue;
    let params: Record<string, unknown>;
    try {
      params = JSON.parse(a.paramsJson) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (params.session_id !== sessionId) continue;
    const text =
      typeof params.text === 'string'
        ? params.text
        : typeof params.message === 'string'
          ? params.message
          : '';
    out.push({ id: a.id, action: a.action, rationale: a.rationale, text });
  }
  return out;
}

/**
 * Prompt that asks Athena to reason about one stale session and, if there's
 * a clear next step, propose writing it into the terminal (which surfaces as
 * an on-tile approval). Kept here so the wording is one source of truth.
 */
export function craftStalePrompt(s: FleetSession): string {
  const label = s.name ?? s.projectLabel;
  // Never-attached sessions have no live agent — don't ask Athena to "unblock"
  // them (she can only decline). Frame it as the diagnosis it is so she
  // confirms the kill instead of re-investigating from scratch.
  if (isNeverAttached(s)) {
    return (
      `Fleet session "${label}" (project ${s.projectLabel}) never attached a Claude agent — it spawned but no ` +
      `Claude Code process ever came up (no session id, no transcript). Do NOT propose fleet_send_input; there's ` +
      `nothing live to type into. Confirm in one line that it should be killed (the folder likely needs Claude Code ` +
      `trust approval, or claude failed to start there).`
    );
  }
  return (
    `Fleet session "${label}" (project ${s.projectLabel}) has gone stale — no activity for several minutes. ` +
    `Look at what it was doing and decide the single best next step to unblock it. ` +
    `If there's a clear winner, propose a fleet_send_input action with the exact text to type (press_enter true) so I can approve it. ` +
    `If it needs human judgment or is actually finished, say so instead of proposing an action.`
  );
}
