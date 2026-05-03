/**
 * BackgroundServices — lazy-loaded component that activates background hooks.
 *
 * These hooks import from domain stores (agentStore, vaultStore, overviewStore)
 * which cascade ~300 KB of API + slice code. By lazy-loading this component,
 * that code is deferred out of the main bundle and loaded after first paint.
 *
 * Renders nothing — purely a hook host.
 */

import { useLabEvents } from "@/hooks/lab/useLabEvents";
import { useHealthDigestScheduler, useHealthDigestPrefetch } from "@/features/agents/health";
import { useRemediationEvaluator } from "@/features/vault/shared/hooks/health/useRemediationEvaluator";


export default function BackgroundServices() {
  useLabEvents();
  useHealthDigestScheduler();
  useHealthDigestPrefetch();
  // Activates the credential remediation loop — periodically scans all
  // credentials for anomaly signals and dispatches remediation actions
  // (auto-rotate, auto-disable, notify). The evaluator's return value
  // (lastEvaluation, evaluating, forceEvaluate, eventLog) isn't needed
  // at the app level; mount-side-effect is what matters here.
  useRemediationEvaluator();
  return null;
}
