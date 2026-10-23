// Short-lived reuse of credential healthchecks for the improve surfaces.
//
// Every healthcheck is a provider round-trip. Opening the Monitoring modal
// checks every credential across ~33 service types, and each Deploy popover on
// an observability row repeats the same checks, so a user moving between them
// paid for the same answer many times. Health here is advisory (a degraded
// candidate stays bindable), so a recent HEALTHY result is good enough; an
// unhealthy or failed one is never kept, because the usual next step is fixing
// the credential in the vault and coming straight back.
import { healthcheckCredential } from '@/api/vault/credentials';

/** How long a healthy result is served without asking the provider again. */
export const HEALTHY_TTL_MS = 60_000;

const healthyAt = new Map<string, number>();
const inFlight = new Map<string, Promise<boolean>>();

/** `true` when the credential's healthcheck succeeds; rejects like the IPC does. */
export function cachedHealthcheck(credentialId: string): Promise<boolean> {
  const at = healthyAt.get(credentialId);
  if (at !== undefined && Date.now() - at < HEALTHY_TTL_MS) return Promise.resolve(true);

  const pending = inFlight.get(credentialId);
  if (pending) return pending;

  const run = healthcheckCredential(credentialId)
    .then((r) => {
      if (r.success) healthyAt.set(credentialId, Date.now());
      else healthyAt.delete(credentialId);
      return r.success;
    })
    .finally(() => { inFlight.delete(credentialId); });
  inFlight.set(credentialId, run);
  return run;
}

/** Test seam: forget every cached result. */
export function resetCredentialHealthCache(): void {
  healthyAt.clear();
  inFlight.clear();
}
