/**
 * Typed IPC wrappers for the Athena/companion **bridge** commands — the
 * event-driven side channels that mirror frontend activity (fleet lifecycle,
 * MCP pending requests, team-assignment outcomes) into the companion brain,
 * plus the small read-only stats/digest endpoints those surfaces poll.
 *
 * Separated from the (very large) `@/api/companion` module because these are
 * consumed exclusively by the always-mounted bridge hooks under
 * `src/features/plugins/companion/**`, not by the chat UI.
 *
 * Added by the 2026-05-10 orphan-commands wrap ADR: bridge hooks used to call
 * `invokeWithTimeout` directly, which meant the fleet-event discriminator and
 * its per-kind payload fields had no compile-time contract at all.
 */
import { invokeWithTimeout as invoke } from '@/lib/tauriInvoke';

// ============================================================================
// Wake cadence (autonomy window)
// ============================================================================

export interface CompanionWakeSurfaceStats {
  surface: string;
  wakes: number;
  signals: number;
  cli_calls: number;
  actions: number;
}

export interface CompanionWakeStats {
  window_minutes: number;
  surfaces: CompanionWakeSurfaceStats[];
}

/** 24 h rollup of autonomy wakes/signals/actions, grouped by surface. */
export const companionWakeStats = () =>
  invoke<CompanionWakeStats>('companion_wake_stats', {});

// ============================================================================
// MCP pending requests
// ============================================================================

export type CompanionMcpRequestKind = 'guidance' | 'approval';

export interface CompanionMcpPendingRequest {
  requestId: string;
  kind: CompanionMcpRequestKind;
  fleetSessionId: string;
}

/**
 * Snapshot of MCP requests still blocking a fleet session. Payloads are NOT
 * included — only the (id, kind, session) tuple — so a caller restoring state
 * after a reload must stub the payload.
 */
export const companionMcpPendingSnapshot = () =>
  invoke<CompanionMcpPendingRequest[]>('companion_mcp_pending_snapshot', {});

/**
 * Send a response back to a blocked MCP handler. Resolves `false` when the
 * request id is no longer pending (already resolved, or the session died).
 */
export const companionMcpResolveRequest = (
  requestId: string,
  response: Record<string, unknown>,
) => invoke<boolean>('companion_mcp_resolve_request', { requestId, response });

// ============================================================================
// Operative memory
// ============================================================================

/** Prompt-ready digest of Athena's in-process "what's happening now" view. */
export const companionGetOperativeMemoryDigest = () =>
  invoke<string>('companion_get_operative_memory_digest', {});

// ============================================================================
// Fleet lifecycle events
// ============================================================================

interface FleetEventBase {
  sessionId: string;
  claudeSessionId: string | null;
  projectLabel: string;
  cwd: string;
}

/**
 * Discriminated union mirroring the Rust `match input.kind.as_str()` in
 * `commands/companion/fleet_bridge.rs`. The backend rejects any other `kind`
 * with `AppError::Validation`, and rejects a `state_changed` whose `state`
 * isn't a known `FleetSessionState` token — both of which are now unreachable
 * from TypeScript.
 */
export type CompanionFleetEventInput =
  | (FleetEventBase & { kind: 'spawned'; athenaOwned?: boolean })
  | (FleetEventBase & { kind: 'exited'; exitCode: number | null })
  | (FleetEventBase & {
      kind: 'state_changed';
      state: string;
      reason?: string | null;
    });

/** Record a fleet-session lifecycle transition into episodic + operative memory. */
export const companionRecordFleetEvent = (input: CompanionFleetEventInput) =>
  invoke<string>('companion_record_fleet_event', { input });

// ============================================================================
// Team assignments
// ============================================================================

/**
 * Reconcile a finished team assignment back into Athena's operative memory.
 * Resolves `false` when the assignment wasn't Athena-dispatched (no
 * `companion_op_id`) — that's a no-op, not an error.
 */
export const companionRecordAssignmentOutcome = (assignmentId: string) =>
  invoke<boolean>('companion_record_assignment_outcome', { assignmentId });
