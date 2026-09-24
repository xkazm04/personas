import { useCallback } from 'react';
import { Compass } from 'lucide-react';
import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';

/**
 * Escape hatch that makes Skip reversible for the first-run onboarding modal.
 *
 * Without this, `reopenOnboarding`/`resumeOnboarding` had zero callers: once a
 * user skipped or finished onboarding, `startOnboarding` early-returns forever
 * (completed || personas>0), so the welcome flow could never be seen again.
 *
 * Shows only once onboarding is out of the way (not active) AND there is
 * something to return to:
 *  - dismissed mid-flow (`onboardingDismissedAtStep` set, not completed) →
 *    RESUME at the recorded step via `resumeOnboarding`.
 *  - finished or skipped-to-completion (`onboardingCompleted`) → REOPEN from
 *    the top via `reopenOnboarding`.
 * The label reflects which of the two it is.
 */
export default function OnboardingReplayFooterIcon() {
  const { t } = useTranslation();
  const onboardingActive = useSystemStore((s) => s.onboardingActive);
  const onboardingCompleted = useSystemStore((s) => s.onboardingCompleted);
  const dismissedAtStep = useSystemStore((s) => s.onboardingDismissedAtStep);

  // Dismissed-but-not-completed takes precedence: resuming where they left off
  // is more useful than restarting from scratch.
  const canResume = !onboardingCompleted && dismissedAtStep != null;
  const canReopen = onboardingCompleted;
  const show = !onboardingActive && (canResume || canReopen);

  const handleClick = useCallback(() => {
    if (canResume) {
      useSystemStore.getState().resumeOnboarding();
    } else {
      useSystemStore.getState().reopenOnboarding();
    }
  }, [canResume]);

  if (!show) return null;

  const label = canResume ? t.onboarding.resume_setup : t.onboarding.replay_setup;
  return (
    <button
      type="button"
      onClick={handleClick}
      data-testid="footer-replay-onboarding"
      className="h-7 px-2 rounded-lg flex items-center gap-1.5 text-foreground hover:text-foreground hover:bg-secondary/50 transition-colors"
      title={label}
      aria-label={label}
    >
      <Compass className="w-4 h-4" />
      <span className="typo-caption">{label}</span>
    </button>
  );
}
