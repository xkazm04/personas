/**
 * useRemediationEvaluator
 *
 * Periodically evaluates all credentials' anomaly scores and dispatches
 * remediation actions through the bus. This hook closes the loop between
 * passive anomaly detection and active remediation.
 *
 * Signal flow:
 *   credential metadata -> anomaly_score -> remediation level
 *     -> actionsForRemediation() -> remediationBus.dispatch()
 *     -> executeRemediationAction() -> rotate / disable / notify
 *
 * Mount this once at the app level (e.g., in SystemHealthPanel or App.tsx).
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import { useVaultStore } from "@/stores/vaultStore";
import { getRotationStatus, type RotationStatus } from '@/api/vault/rotation';
import {
  remediationBus,
  actionsForRemediation,
  type RemediationEvent,
} from '@/lib/credentials/remediationBus';
import { executeRemediationAction } from '@/lib/credentials/remediationExecutor';

/** Evaluation interval: check all credentials every 30 minutes. */
const EVAL_INTERVAL_MS = 30 * 60 * 1000;

/** Minimum credentials to evaluate (skip if store is empty). */
const MIN_CREDENTIALS = 1;

interface EvaluationResult {
  credentialId: string;
  credentialName: string;
  rotationStatus: RotationStatus | null;
  dispatched: RemediationEvent[];
}

/**
 * Parse anomaly_score from credential metadata JSON.
 */
function parseAnomalyFromMetadata(
  metadata: string | null,
): { anomaly_score?: { remediation: string } } | null {
  if (!metadata) return null;
  try {
    return JSON.parse(metadata);
  } catch {
    return null;
  }
}

/**
 * Hook: evaluates credential anomaly scores and dispatches remediation actions.
 *
 * Returns the latest evaluation log for UI consumption.
 */
export function useRemediationEvaluator() {
  const credentials = useVaultStore((s) => s.credentials);
  const [lastEvaluation, setLastEvaluation] = useState<EvaluationResult[]>([]);
  const [evaluating, setEvaluating] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);

  const evaluate = useCallback(async () => {
    if (credentials.length < MIN_CREDENTIALS) return;
    setEvaluating(true);

    const results: EvaluationResult[] = [];

    for (const cred of credentials) {
      if (!mountedRef.current) break;

      // Fast path: check metadata-embedded anomaly_score first.
      // Only fetch full rotation status if metadata suggests anomaly.
      const parsed = parseAnomalyFromMetadata(cred.metadata);
      const embeddedRemediation = parsed?.anomaly_score?.remediation;

      // Skip healthy credentials entirely (no API call needed)
      if (!embeddedRemediation || embeddedRemediation === 'healthy') {
        continue;
      }

      // Credential has non-healthy remediation -- fetch full rotation status
      let rotationStatus: RotationStatus | null;
      try {
        rotationStatus = await getRotationStatus(cred.id);
      } catch {
        continue;
      }

      if (!rotationStatus?.anomaly_score) continue;

      const { anomaly_score } = rotationStatus;
      const actions = actionsForRemediation(anomaly_score.remediation) ?? [];
      const dispatched: RemediationEvent[] = [];

      for (const action of actions) {
        const event = remediationBus.dispatch({
          credentialId: cred.id,
          credentialName: cred.name,
          action,
          remediation: anomaly_score.remediation,
          reason: buildReason(anomaly_score.remediation, anomaly_score),
          anomalyScore: anomaly_score,
        });

        if (event) {
          dispatched.push(event);
          // Execute the action asynchronously (don't block evaluation loop)
          void executeRemediationAction(event);
        }
      }

      if (dispatched.length > 0) {
        results.push({
          credentialId: cred.id,
          credentialName: cred.name,
          rotationStatus,
          dispatched,
        });
      }
    }

    if (mountedRef.current) {
      setLastEvaluation(results);
      setEvaluating(false);
    }
  }, [credentials]);

  // Start periodic evaluation
  useEffect(() => {
    mountedRef.current = true;

    const safeEvaluate = () => {
      evaluate().catch(() => {
        if (mountedRef.current) setEvaluating(false);
      });
    };

    // Initial evaluation after startup settles (avoid IPC contention)
    const initialTimeout = setTimeout(safeEvaluate, 15_000);

    // Periodic evaluation
    timerRef.current = setInterval(safeEvaluate, EVAL_INTERVAL_MS);

    return () => {
      mountedRef.current = false;
      clearTimeout(initialTimeout);
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [evaluate]);

  /** Force an immediate re-evaluation (e.g., after manual healthcheck). */
  const forceEvaluate = useCallback(() => {
    remediationBus.resetCooldowns();
    evaluate().catch(() => {
      if (mountedRef.current) setEvaluating(false);
    });
  }, [evaluate]);

  return {
    /** Results from the last evaluation cycle. */
    lastEvaluation,
    /** Whether an evaluation is currently in progress. */
    evaluating,
    /** Force immediate re-evaluation, bypassing cooldowns. */
    forceEvaluate,
    /** Read-only access to the full remediation event log. */
    eventLog: remediationBus.log,
  };
}

// -- Helpers ---------------------------------------------------------

function buildReason(
  remediation: string,
  score: { failure_rate_1h: number; permanent_failure_rate_1h: number; transient_failure_rate_1h: number },
): string {
  const pct = (v: number) => `${(v * 100).toFixed(0)}%`;

  switch (remediation) {
    case 'backoff_retry':
      return `Transient failure rate at ${pct(score.transient_failure_rate_1h)} (1h). Applying exponential backoff.`;
    case 'preemptive_rotation':
      return `Sustained degradation: ${pct(score.failure_rate_1h)} failure rate (1h). Scheduling preemptive rotation.`;
    case 'rotate_then_alert':
      return `Permanent errors detected: ${pct(score.permanent_failure_rate_1h)} permanent failure rate (1h). Rotating and alerting.`;
    case 'disable':
      return `Critical: ${pct(score.permanent_failure_rate_1h)} permanent failure rate (1h). Auto-disabling rotation policies.`;
    default:
      return `Remediation level: ${remediation}`;
  }
}
