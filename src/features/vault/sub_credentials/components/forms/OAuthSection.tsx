import { CheckCircle, Shield } from 'lucide-react';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { OAuthProgressRing, type OAuthRingPhase } from './OAuthProgressRing';

interface OAuthSectionProps {
  onConsent: () => void;
  consentLabel?: string;
  consentHint?: string;
  consentDisabled?: boolean;
  consentDisabledReason?: string;
  consentSuccessBadge?: string;
  /** Whether an OAuth authorization is currently in progress */
  isAuthorizing?: boolean;
  /** Current status message from the OAuth polling hook */
  pollingMessage?: { success: boolean; message: string } | null;
}

/** Derive the ring phase from OAuth state */
function deriveRingPhase(
  isAuthorizing: boolean,
  pollingMessage: { success: boolean; message: string } | null,
): OAuthRingPhase | null {
  if (!isAuthorizing && pollingMessage?.success) return 'success';
  if (!isAuthorizing) return null;

  // "Starting..." = waiting; once browser opens = polling
  if (pollingMessage?.message?.includes('consent page opened')) return 'polling';
  return 'waiting';
}

export function OAuthSection({
  onConsent,
  consentLabel,
  consentHint,
  consentDisabled,
  consentDisabledReason,
  consentSuccessBadge,
  isAuthorizing = false,
  pollingMessage = null,
}: OAuthSectionProps) {
  const ringPhase = deriveRingPhase(isAuthorizing, pollingMessage);

  return (
    <>
      <div className="border-t border-primary/8" />
      <div>
        <h4 className="typo-heading font-semibold uppercase tracking-wider text-foreground mb-3">
          Authentication
        </h4>

        {/* Progress ring shown during active OAuth flow */}
        {ringPhase && (
          <div className="flex justify-center py-3 mb-3">
            <OAuthProgressRing
              phase={ringPhase}
              message={pollingMessage?.message}
            />
          </div>
        )}

        {/* Authorize button (hidden while ring is active to reduce clutter) */}
        {!ringPhase && (
          <>
            <Tooltip content={consentDisabled && consentDisabledReason ? consentDisabledReason : ''} placement="top" delay={200}>
              <button
                onClick={onConsent}
                type="button"
                disabled={consentDisabled}
                className="flex items-center gap-2 px-4 py-2 border rounded-modal typo-body font-medium transition-all bg-blue-500/10 hover:bg-blue-500/20 border-blue-500/25 text-blue-300 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Shield className="w-4 h-4" />
                {consentLabel || 'Authorize with Google'}
              </button>
            </Tooltip>
            {consentHint && (
              <p className="mt-1.5 typo-body text-foreground">{consentHint}</p>
            )}
          </>
        )}

        {consentSuccessBadge && !ringPhase && (
          <div className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/15 border border-emerald-500/25 text-emerald-300 typo-body">
            <CheckCircle className="w-3.5 h-3.5" />
            {consentSuccessBadge}
          </div>
        )}
      </div>
    </>
  );
}
