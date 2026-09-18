/**
 * Three-state credential health banner.
 *
 * A probe has three outcomes, not two: verified, failed, and unverifiable
 * (timeout, offline host, or a connector with no probe at all). Collapsing
 * unverifiable into failed is what turns red into noise: an operator rotates a
 * perfectly good key because the laptop was offline. `HealthResult.state`
 * carries the typed outcome and `computeHealthScore` already treats
 * unverifiable as neutral 50 rather than 0 - this banner is the surface
 * catching up with both.
 *
 * Legacy and persisted results carry no `state`; those fall back to the
 * boolean, and a result restored from credential metadata is labelled stored
 * rather than presented as a live verdict.
 */
import { CheckCircle2, PlugZap, ShieldQuestion, XCircle, RefreshCw } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { useTranslation } from '@/i18n/useTranslation';
import type { HealthResult } from '@/features/vault/shared/hooks/health/useCredentialHealth';
import { resolveProbeOutcome, type HealthState } from '@/lib/credentials/healthState';

type ProbeOutcomeState = Exclude<HealthState, 'untested'>;

/**
 * Re-exported from the shared resolver. Both the type and the decision used to
 * live here in a three-token form, so `unreachable` -- which the backend does
 * send -- fell through to `success ? verified : failed` and painted a network
 * outage as a rejected key.
 */
export type HealthProbeState = ProbeOutcomeState;
export const resolveProbeState = (result: HealthResult): HealthProbeState =>
  resolveProbeOutcome(result);

const CHROME: Record<HealthProbeState, { box: string; Icon: typeof CheckCircle2 }> = {
  verified: {
    box: 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400',
    Icon: CheckCircle2,
  },
  unverifiable: {
    box: 'bg-secondary/40 border border-border/40 text-foreground',
    Icon: ShieldQuestion,
  },
  // Could-not-reach shares the neutral treatment with could-not-verify: both
  // are the absence of a verdict, and neither is evidence against the key.
  unreachable: {
    box: 'bg-secondary/40 border border-border/40 text-foreground',
    Icon: PlugZap,
  },
  failed: {
    box: 'bg-red-500/10 border border-red-500/20 text-red-400',
    Icon: XCircle,
  },
};

export function HealthProbeBanner({
  result,
  onRetry,
  isRetrying,
}: {
  result: HealthResult;
  onRetry?: () => void;
  isRetrying?: boolean;
}) {
  const { t } = useTranslation();
  const sh = t.vault.shared;
  const state = resolveProbeState(result);
  const chrome = CHROME[state];
  const label =
    state === 'verified'
      ? sh.health_verified
      : state === 'unverifiable'
        ? sh.health_unverifiable
        : state === 'unreachable'
          ? sh.health_unreachable
          : sh.health_failed;
  // Retry is offered for both no-verdict states: neither says anything about
  // the credential, so asking again is the only way to learn something.
  const canRetry = state === 'unverifiable' || state === 'unreachable';

  return (
    <div
      data-testid="health-probe-banner"
      data-state={state}
      className={`flex items-start gap-2 px-4 py-3 rounded-modal typo-body ${chrome.box}`}
    >
      <chrome.Icon className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold">{label}</span>
          {result.isStale && (
            <span
              data-testid="health-probe-stale"
              className="typo-caption px-1.5 py-0.5 rounded bg-secondary/60 text-foreground"
            >
              {sh.health_stored_result}
            </span>
          )}
        </div>
        {result.message && <p className="break-all">{result.message}</p>}
        {canRetry && onRetry && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onRetry}
            loading={isRetrying}
            icon={!isRetrying ? <RefreshCw className="w-3 h-3" /> : undefined}
            data-testid="health-probe-retry"
          >
            {sh.health_retry_probe}
          </Button>
        )}
      </div>
    </div>
  );
}
