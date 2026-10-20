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

import { rotateCredentialNow, listRotationPolicies, updateRotationPolicy } from '@/api/vault/rotation';
import { sendOsNotification } from '@/lib/utils/platform/osNotification';
import { remediationBus, type RemediationEvent, type RemediationAction } from './remediationBus';
import { extractMessage } from '@/lib/silentCatch';
import { getActiveTranslations, interpolate as tx } from '@/i18n/useTranslation';

// The rotation IPC rejects with a serialized AppError OBJECT, never an Error:
// `err instanceof Error` turned every refusal into the bare fallback, so the
// OS notification and the outcome log never carried the backend's reason.
function reasonOf(err: unknown, fallback: string): string {
  return extractMessage(err) || fallback;
}

// -- Action Handlers -------------------------------------------------

async function executeAutoRotate(event: RemediationEvent): Promise<void> {
  try {
    const detail = await rotateCredentialNow(event.credentialId);
    remediationBus.updateOutcome(event.id, 'success', detail);
  } catch (err) {
    const message = reasonOf(err, 'Rotation failed');
    remediationBus.updateOutcome(event.id, 'failed', message);
    // Rotation failure triggers a notification
    void sendOsNotification(
      getActiveTranslations().vault.remediation_notify.rotation_failed_title,
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
      await updateRotationPolicy(policy.id, { enabled: false, rotation_interval_days: null });
    }

    remediationBus.updateOutcome(
      event.id,
      'success',
      `Disabled ${enabledPolicies.length} rotation ${enabledPolicies.length === 1 ? 'policy' : 'policies'}`,
    );

    void sendOsNotification(
      getActiveTranslations().vault.remediation_notify.auto_disabled_title,
      tx(getActiveTranslations().vault.remediation_notify.auto_disabled_body, { name: event.credentialName }),
    );
  } catch (err) {
    const message = reasonOf(err, 'Disable failed');
    remediationBus.updateOutcome(event.id, 'failed', message);
  }
}

async function executeNotify(event: RemediationEvent): Promise<void> {
  const severity = event.action === 'notify_critical' ? 'Critical' : 'Warning';
  const rn = getActiveTranslations().vault.remediation_notify;
  const title = event.action === 'notify_drift'
    ? rn.drift_title
    : event.action === 'notify_critical' ? rn.critical_title : rn.warning_title;

  void sendOsNotification(title, `${event.credentialName}: ${event.reason}`);
  remediationBus.updateOutcome(event.id, 'success', `${severity} notification sent`);
}

function executeBackoff(event: RemediationEvent): void {
  // Backoff is handled at the engine/scheduler level (Rust).
  // We just log it for visibility.
  remediationBus.updateOutcome(event.id, 'success', 'Backoff signal recorded');
}

// -- Executor Dispatch -----------------------------------------------

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
      reasonOf(err, 'Execution error'),
    );
  }
}
