/**
 * Remediation Action Executor
 *
 * Executes remediation actions dispatched by the remediation bus:
 *   - auto_rotate: calls rotateCredentialNow()
 *   - auto_disable: disables the rotation policy via updateRotationPolicy()
 *   - notify_*: fires OS notification + credential alert in the alert system
 *   - backoff: logs only (backoff is handled at the engine/scheduler level)
 *
 * Each action is idempotent and updates the bus event outcome on completion.
 */

import { rotateCredentialNow, listRotationPolicies, updateRotationPolicy } from '@/api/rotation';
import { sendOsNotification } from '@/lib/utils/osNotification';
import { remediationBus, type RemediationEvent, type RemediationAction } from './remediationBus';

// ── Action Handlers ─────────────────────────────────────────────────

async function executeAutoRotate(event: RemediationEvent): Promise<void> {
  try {
    const detail = await rotateCredentialNow(event.credentialId);
    remediationBus.updateOutcome(event.id, 'success', detail);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Rotation failed';
    remediationBus.updateOutcome(event.id, 'failed', message);
    // Rotation failure triggers a notification
    void sendOsNotification(
      'Credential Rotation Failed',
      `${event.credentialName}: ${message}`,
    );
  }
}

async function executeAutoDisable(event: RemediationEvent): Promise<void> {
  try {
    const policies = await listRotationPolicies(event.credentialId);
    const enabledPolicies = policies.filter((p) => p.enabled);

    if (enabledPolicies.length === 0) {
      remediationBus.updateOutcome(event.id, 'skipped', 'No enabled policies to disable');
      return;
    }

    for (const policy of enabledPolicies) {
      await updateRotationPolicy(policy.id, { enabled: false });
    }

    remediationBus.updateOutcome(
      event.id,
      'success',
      `Disabled ${enabledPolicies.length} rotation ${enabledPolicies.length === 1 ? 'policy' : 'policies'}`,
    );

    void sendOsNotification(
      'Credential Auto-Disabled',
      `${event.credentialName}: sustained critical failures detected. Rotation policies disabled to prevent cascading errors.`,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Disable failed';
    remediationBus.updateOutcome(event.id, 'failed', message);
  }
}

async function executeNotify(event: RemediationEvent): Promise<void> {
  const severity = event.action === 'notify_critical' ? 'Critical' : 'Warning';
  const title = event.action === 'notify_drift'
    ? 'Credential Drift Detected'
    : `Credential ${severity}`;

  void sendOsNotification(title, `${event.credentialName}: ${event.reason}`);
  remediationBus.updateOutcome(event.id, 'success', `${severity} notification sent`);
}

function executeBackoff(event: RemediationEvent): void {
  // Backoff is handled at the engine/scheduler level (Rust).
  // We just log it for visibility.
  remediationBus.updateOutcome(event.id, 'success', 'Backoff signal recorded');
}

// ── Executor Dispatch ───────────────────────────────────────────────

const ACTION_HANDLERS: Record<RemediationAction, (event: RemediationEvent) => void | Promise<void>> = {
  auto_rotate: executeAutoRotate,
  auto_disable: executeAutoDisable,
  notify_drift: executeNotify,
  notify_degraded: executeNotify,
  notify_critical: executeNotify,
  backoff: executeBackoff,
};

/**
 * Execute a remediation event's action.
 * Called by the evaluator hook after dispatching an event through the bus.
 */
export async function executeRemediationAction(event: RemediationEvent): Promise<void> {
  const handler = ACTION_HANDLERS[event.action];
  if (!handler) {
    remediationBus.updateOutcome(event.id, 'skipped', `Unknown action: ${event.action}`);
    return;
  }

  try {
    await handler(event);
  } catch (err) {
    remediationBus.updateOutcome(
      event.id,
      'failed',
      err instanceof Error ? err.message : 'Execution error',
    );
  }
}
