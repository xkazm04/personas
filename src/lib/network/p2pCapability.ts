/**
 * P2P capability probe — "does this build actually have the `p2p` feature?"
 *
 * ## Why this exists
 *
 * The Network surfaces used to infer feature availability by lower-casing every
 * IPC rejection and looking for the substrings `"not found"` /
 * `"not allowed by the scope"`. That heuristic was wrong in both directions:
 *
 *  - **False positives.** `AppError::NotFound("No pairing request pending from …")`
 *    is a perfectly normal runtime error whose message contains "not found". The
 *    old sniff would read it as "this build has no p2p" and permanently latch
 *    `p2pUnavailable` for the whole session, blanking the tab until restart.
 *  - **Blind spots.** Only three read paths consulted it; every mutating action
 *    bypassed it entirely, so a lite build surfaced calm empty states for reads
 *    and raw error toasts for writes.
 *
 * ## What replaces it
 *
 * ONE explicit probe, run at most once per session, against a cheap read-only
 * `p2p`-gated command. The verdict is derived STRUCTURALLY, not from message
 * text:
 *
 *  - **Resolves** → the command is registered and ran → supported.
 *  - **Rejects with a structured `AppError`** (`{ error, kind, … }`, see
 *    `@/lib/types/tauriError`) → the command is registered and executed; this is
 *    a genuine runtime error → still supported, and NOT latched.
 *  - **Rejects with an unstructured value** (Tauri's own unregistered-command /
 *    permission-scope rejection is a bare string) → the command does not exist
 *    in this build → unsupported.
 *  - **Times out** → indeterminate. Nothing is latched and the next call
 *    re-probes, because a slow backend is not a missing feature.
 *
 * Callers await {@link probeP2pSupport} before every p2p IPC call — reads AND
 * writes. {@link isP2pRuntimeError} is the companion for classifying errors
 * thrown by calls that already passed the probe.
 */
import { InvokeTimeoutError } from '@/lib/tauriInvoke';
import { isTauriError } from '@/lib/types/tauriError';
import { getNetworkStatus } from '@/api/network/discovery';
import { createLogger } from '@/lib/log';

const logger = createLogger('p2p-capability');

/** Outcome of a single probe attempt. */
export type P2pProbeVerdict = 'supported' | 'unsupported' | 'indeterminate';

/**
 * Classify an IPC rejection into a probe verdict, without reading message text.
 *
 * Exported for unit tests and for `isP2pRuntimeError`; prefer the probe itself
 * at call sites.
 */
export function classifyProbeRejection(err: unknown): P2pProbeVerdict {
  // A timeout says nothing about whether the command exists.
  if (err instanceof InvokeTimeoutError) return 'indeterminate';
  // A structured AppError can only be produced by a command that ran.
  if (isTauriError(err)) return 'supported';
  // Anything else (bare string, generic Error) is Tauri refusing to dispatch.
  return 'unsupported';
}

/**
 * True when `err` came from a command that actually executed — i.e. a real
 * runtime failure the operator should see, not a missing-feature artifact.
 */
export function isP2pRuntimeError(err: unknown): boolean {
  return classifyProbeRejection(err) !== 'unsupported';
}

/** Resolved verdict for the session, or `null` while unknown. */
let verdict: boolean | null = null;
/** In-flight probe, so N concurrent callers issue exactly ONE IPC call. */
let inflight: Promise<boolean> | null = null;

/**
 * Probe (once) whether this build supports p2p. Concurrent callers share the
 * single in-flight request; an indeterminate result is not cached, so the next
 * caller retries.
 */
export function probeP2pSupport(): Promise<boolean> {
  if (verdict !== null) return Promise.resolve(verdict);
  if (inflight) return inflight;

  inflight = runProbe().finally(() => {
    inflight = null;
  });

  return inflight;
}

async function runProbe(): Promise<boolean> {
  try {
    await getNetworkStatus();
    verdict = true;
    return true;
  } catch (err) {
    const outcome = classifyProbeRejection(err);
    if (outcome === 'indeterminate') {
      // Do NOT latch: a slow or busy backend must not disable the feature for
      // the rest of the session. Leaving `verdict` null makes the next caller
      // re-probe.
      logger.warn('p2p capability probe was indeterminate; will retry', { error: err });
      return true;
    }
    verdict = outcome === 'supported';
    if (!verdict) {
      logger.info('p2p feature is not present in this build; network surfaces will show the unavailable state');
    }
    return verdict;
  }
}

/** Synchronous read of the cached verdict. `null` until the probe settles. */
export function p2pSupportVerdict(): boolean | null {
  return verdict;
}

/** Test-only: forget the cached verdict and any in-flight probe. */
export function resetP2pProbeForTests(): void {
  verdict = null;
  inflight = null;
}
