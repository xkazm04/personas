/**
 * Fleet ↔ Athena fusion helpers — attention levels for terminal tiles and
 * the mapping from Athena's pending approvals to the session they target.
 *
 * Pure functions (no React) so both the grid overlay and the single pane can
 * share them, and so they're trivially testable.
 */
import type { FleetSession } from '@/lib/bindings/FleetSession';
import type { PendingApproval } from '@/api/companion';

/** Visual attention a session warrants. `none` → use the base border.
 *  `athena` = she's actively reasoning about this session's ticket (light blue). */
export type FleetAttention = 'waiting' | 'stale' | 'failed' | 'athena' | 'none';

/** Prefix of the Rust ticker's never-attached `state_reason` (see
 *  `stale.rs::is_never_attached`). Keep in sync with that string. */
const NEVER_ATTACHED_REASON = 'Claude never attached';

/**
 * True when a session never attached a Claude agent. The authoritative signal
 * is the Rust ticker's `state_reason` verdict (its confident 2-min no-activity
 * check) — NOT a broad "stale without a cc id" guess, which misfires on a
 * genuinely-working session whose cc id simply hasn't bound yet (that one is
 * normal `stale` and should still show real state + the Ask-Athena button).
 * For a real never-attached session, asking Athena to "unblock" it is futile
 * (no live agent to type into) — kill + retry instead (often the folder needs
 * Claude Code's trust approval).
 */
export function isNeverAttached(s: Pick<FleetSession, 'stateReason'>): boolean {
  return s.stateReason?.startsWith(NEVER_ATTACHED_REASON) ?? false;
}

/** Classify a session by how much it wants the operator's (or Athena's) eyes. */
export function sessionAttention(
  s: Pick<FleetSession, 'state' | 'exitCode' | 'athenaActive'>,
): FleetAttention {
  // Athena has taken this awaiting ticket and is reasoning — show that (light
  // blue) instead of "needs you" (violet). If she defers or her window lapses,
  // `athenaActive` drops and it falls through to the real state below.
  if (s.athenaActive) return 'athena';
  switch (s.state) {
    case 'awaiting_input':
      return 'waiting';
    case 'stale':
      // Stale is stale (amber) — including never-attached. We do NOT paint it
      // red 'failed': that misreads as a crash and hid the real state. The
      // never-attached distinction is handled in the Athena strip (note vs
      // Ask-button), not the border colour.
      return 'stale';
    case 'exited':
      return s.exitCode != null && s.exitCode !== 0 ? 'failed' : 'none';
    default:
      return 'none';
  }
}

/**
 * Whether a session needs the operator's eyes RIGHT NOW — i.e. the grid should
 * render a full live terminal for it rather than a cheap status block. Only
 * `awaiting_input` qualifies today: Claude is blocked asking for input that
 * Athena couldn't (or shouldn't) answer autonomously. Everything else either
 * runs autonomously (`running`/`spawning`/`idle`) or is silently triaged by
 * Athena (`stale`) and gets a status block — Athena still sees ALL of it via the
 * backend (operative memory + ring + transcript), and escalates by raising the
 * tile (a proposal, or the session flipping to `awaiting_input`). `exited`/
 * `hibernated` are filtered out of the live grid upstream. Extension point: add
 * escalated-`stale` here once Athena flags a stale session as needing a human.
 */
export function needsLiveAttention(s: Pick<FleetSession, 'state'>): boolean {
  return s.state === 'awaiting_input';
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
    case 'athena':
      return 'fleet-attn-athena';
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
    `Fleet flagged session "${label}" (project ${s.projectLabel}) as stale — no activity for several minutes. ` +
    `Assess what it was doing and decide the single best next step to unblock it. ` +
    `If there's a clear winner, propose a fleet_send_input action with the exact text to type (press_enter true) for the operator to approve. ` +
    `If it needs human judgment or is actually finished, say so instead of proposing an action.`
  );
}
