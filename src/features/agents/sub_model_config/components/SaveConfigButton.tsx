import { useTranslation } from '@/i18n/useTranslation';
import AsyncButton from '@/features/shared/components/buttons/AsyncButton';

interface SaveConfigButtonProps {
  /**
   * Returning the promise is load-bearing: `AsyncButton` uses it to hold a
   * synchronous in-flight guard and paint a real spinner. A `() => void`
   * handler that swallows its own promise silently disarms both.
   */
  onClick: () => void | Promise<void>;
  disabled: boolean;
  saved: boolean;
  label?: string;
}

/**
 * Save control for a provider credential.
 *
 * This was a hand-rolled `<button>` with `disabled` and a `saved` flag and
 * nothing else until 2026-08-28: during the await of `setAppSetting` — an IPC
 * round-trip that may touch the OS keyring — it looked completely idle, so a
 * second click re-entered the handler and issued a second write. `AsyncButton`
 * supplies the three things the spinner boundary requires of a control the
 * user just pressed: a visible spinner, `disabled`, and `aria-busy`, plus a
 * synchronous guard that rejects the second click before React can re-render.
 */
export function SaveConfigButton({ onClick, disabled, saved, label }: SaveConfigButtonProps) {
  const { t } = useTranslation();
  const displayLabel = label ?? t.common.save;
  return (
    <AsyncButton
      type="button"
      size="sm"
      variant={saved ? 'accent' : 'secondary'}
      accentColor={saved ? 'emerald' : undefined}
      // The resting tint is the primary token, which has no `accent` entry.
      className={saved ? '' : 'bg-primary/20 text-primary border-primary/30 hover:bg-primary/30'}
      disabled={disabled || saved}
      loadingText={t.common.saving}
      onClick={() => onClick()}
    >
      {saved ? t.agents.model_config.saved : displayLabel}
    </AsyncButton>
  );
}
