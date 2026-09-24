/**
 * What has been consumed today, against the ceiling declared for it.
 *
 * Three readings, and they are three different facts:
 *
 * - a cap is declared - `0 of 20`, drawn EVEN WHEN nothing has been consumed.
 *   A meter that hid itself until something was spent would hide the brake as
 *   well, and the brake is the only thing that ever stops her.
 * - no cap is declared - the consumption, and the operator's own words for the
 *   absent ceiling. Never `0 of 0`, which would read as a companion that may
 *   never run.
 * - the runtime did not answer - said plainly. Not zero: unread.
 */
import { useTranslation } from '@/i18n/useTranslation';

export function TodayMeter({ used, cap }: { used: string | null; cap: string | null }) {
  const { t, tx } = useTranslation();
  const s = t.companions.setup;

  if (used === null) {
    return (
      <span className="typo-caption text-foreground opacity-50" data-role="curator-today" data-state="unread">
        {s.curator_today_unread}
      </span>
    );
  }

  return (
    <span
      className="typo-caption text-foreground opacity-70"
      data-role="curator-today"
      data-state={cap === null ? 'uncapped' : 'capped'}
    >
      {cap === null ? tx(s.curator_today_uncapped, { used }) : tx(s.curator_today_of, { used, cap })}
    </span>
  );
}
