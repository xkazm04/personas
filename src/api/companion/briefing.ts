/**
 * Morning Director briefing IPC — session-open composition + the
 * decision-ledger write every briefing action performs.
 *
 * Backend mirror: `src-tauri/src/commands/companion/briefing.rs` and
 * `src-tauri/src/companion/brain/briefing.rs` (serde camelCase — these
 * interfaces are hand-kept in sync; no ts-rs export on the Rust side).
 */
import { invokeWithTimeout as invoke } from '@/lib/tauriInvoke';

/** A persona that failed at least one run since the user left. */
export interface DeltaPersona {
  id: string;
  name: string;
  failedCount: number;
  /** False when already paused — pause actions against it are dropped. */
  enabled: boolean;
}

export interface DeltaAlert {
  ruleName: string;
  severity: string;
  message: string;
  personaId?: string | null;
}

export interface DeltaApproval {
  id: string;
  action: string;
  rationale: string;
}

/**
 * Serializable "what happened while you were away" document. Everything
 * the composer may reference — and everything an action may target — is
 * inside this doc; the backend validates composed actions against it.
 */
export interface SessionDelta {
  /** ISO timestamp of the previous session's end (last-seen anchor). */
  since: string;
  runs: number;
  failedRuns: number;
  alerts: number;
  approvalsWaiting: number;
  /** Open audit incidents (current state — the NOC feed). */
  openIncidents: number;
  failedPersonas: DeltaPersona[];
  alertSummaries: DeltaAlert[];
  pendingApprovals: DeltaApproval[];
}

/** Wire shape returned by `companion_compose_briefing`. */
export interface BriefingSpec {
  /** Serialized cockpit-spec body `{title, widgets, updated_at}`. */
  specJson: string;
  /** Provenance — `"athena"` for LLM-composed (sanitized) specs. */
  composedBy: string;
  generatedAt: string;
}

/**
 * Compose the morning briefing. Returns `null` when the backend gated
 * the call (trivial delta) or composition failed — callers render the
 * deterministic fallback instead. Generous timeout: this is a one-shot
 * LLM call.
 */
export async function companionComposeBriefing(
  delta: SessionDelta,
): Promise<BriefingSpec | null> {
  return invoke<BriefingSpec | null>(
    'companion_compose_briefing',
    { delta },
    { timeoutMs: 90_000 },
  );
}

/**
 * Write one briefing action to the decision audit ledger
 * (`companion_design_decision`, session `morning_briefing`) so the
 * decisions panel shows "what you did about it".
 */
export async function companionRecordBriefingAction(payload: {
  label: string;
  choice: string;
  rationale: string;
  personaContext?: string | null;
}): Promise<void> {
  return invoke<void>('companion_record_briefing_action', {
    label: payload.label,
    choice: payload.choice,
    rationale: payload.rationale,
    personaContext: payload.personaContext ?? null,
  });
}
