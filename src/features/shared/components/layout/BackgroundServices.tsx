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
import { useHealthDigestScheduler, useHealthDigestPrefetch } from "@/features/agents/sub_health";
import { useRemediationEvaluator } from "@/features/vault/shared/hooks/health/useRemediationEvaluator";
import { useLangfuseStackEvents } from "@/features/plugins/langfuse/useLangfuseStackEvents";
import { useAssignmentNotificationDispatcher, useGlobalAssignmentProgressListener } from "@/features/teams/sub_assignments";
import { useAthenaAssignmentReconciliation } from "@/features/plugins/companion/useAthenaAssignmentReconciliation";


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
  // Subscribes to Langfuse stack lifecycle events globally so background
  // start/stop/installer-download progress flows into the global store
  // regardless of which page is currently mounted.
  useLangfuseStackEvents();
  // Watches TEAM_ASSIGNMENT_PROGRESS globally and dispatches a notification
  // into the title-bar notification center when any assignment transitions
  // to awaiting_review. Fires regardless of which page is mounted so the
  // user is reached even if they're not on the team's canvas.
  useAssignmentNotificationDispatcher();
  // Keeps team-assignment state (per-team lists + tracked detail) fresh from
  // the orchestrator's background progress events regardless of the active
  // module, so the live checklist + assignment board reflect reality the
  // instant the user returns to the team.
  useGlobalAssignmentProgressListener();
  // Phase 4 — when an Athena-dispatched assignment finishes, record its outcome
  // into OperativeMemory so Athena's chat can reason about the team's result.
  useAthenaAssignmentReconciliation();
  return null;
}
