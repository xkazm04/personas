import type { Translations } from '@/i18n/generated/types';
import type { TriggerSelection } from '../useCasePickerShared';

type Tx = (template: string, vars: Record<string, string | number>) => string;

/**
 * Human label for a capability's trigger selection, reusing the from-scratch
 * builder's schedule-preview strings. Returns `null` for the Manual default
 * (no row in the left summary).
 */
export function scheduleLabelFromSelection(
  sel: TriggerSelection | undefined,
  t: Translations,
  tx: Tx,
): string | null {
  if (sel?.time) {
    const time = `${String(sel.time.hourOfDay ?? 9).padStart(2, '0')}:00`;
    switch (sel.time.preset) {
      case 'daily':
        return tx(t.agents.glyph_sched_preview_daily, { time });
      case 'weekly':
        return tx(t.agents.glyph_sched_preview_weekly, { time });
      case 'hourly':
        return t.templates.adopt_modal.schedule_hourly;
    }
  }
  if (sel?.customCron) {
    // Best-effort monthly parse: "0 H D * *".
    const parts = sel.customCron.split(/\s+/);
    const hour = Number(parts[1]);
    const day = Number(parts[2]);
    if (!Number.isNaN(hour) && !Number.isNaN(day)) {
      return tx(t.agents.glyph_sched_preview_monthly, {
        day,
        time: `${String(hour).padStart(2, '0')}:00`,
      });
    }
  }
  return null;
}
