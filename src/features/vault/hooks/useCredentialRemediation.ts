/**
 * useCredentialRemediation
 *
 * App-level hook that activates the credential remediation evaluator.
 * Mount once in App.tsx — it periodically scans all credentials for anomaly
 * signals and dispatches remediation actions (auto-rotate, auto-disable, notify).
 *
 * This is the glue that closes the anomaly-to-remediation action loop.
 */

import { useRemediationEvaluator } from './useRemediationEvaluator';

/**
 * Activates the credential remediation loop.
 * Call this once at the app level (like useLabEvents or useHealthDigestScheduler).
 */
export function useCredentialRemediation(): void {
  useRemediationEvaluator();
}
