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

/** Classify a session by how much it wants the operator's (or Athena's) eyes. */
export function sessionAttention(s: Pick<FleetSession, 'state' | 'exitCode'>): FleetAttention {
  switch (s.state) {
    case 'awaiting_input':
      return 'waiting';
    case 'stale':
      return 'stale';
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
  return (
    `Fleet session "${label}" (project ${s.projectLabel}) has gone stale — no activity for several minutes. ` +
    `Look at what it was doing and decide the single best next step to unblock it. ` +
    `If there's a clear winner, propose a fleet_send_input action with the exact text to type (press_enter true) so I can approve it. ` +
    `If it needs human judgment or is actually finished, say so instead of proposing an action.`
  );
}
