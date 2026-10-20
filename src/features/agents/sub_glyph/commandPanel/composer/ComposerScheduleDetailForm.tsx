import { useId } from "react";
import { useTranslation } from "@/i18n/useTranslation";
import type { Rhythm } from "./ComposerScheduleRhythmCard";
import { DebtText } from '@/i18n/DebtText';


export interface DayOption {
  id: string;
  short: string;
  long: string;
}

/** Weekday ids in picker order (match `lib/types/schedule.ts`). */
const DAY_IDS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

/** The seven weekday options in the active language (short + long names). */
export function useDayOptions(): DayOption[] {
  const { t } = useTranslation();
  const short = t.templates.adoption.weekdays;
  return DAY_IDS.map((id) => ({ id, short: short[id], long: t.agents[`glyph_day_long_${id}`] }));
}

interface ComposerScheduleDetailFormProps {
  rhythm: Rhythm;
  time: string;
  onTimeChange: (v: string) => void;
  days: string[];
  onToggleDay: (id: string) => void;
  monthDay: number;
  onMonthDayChange: (n: number) => void;
}

export function ComposerScheduleDetailForm({
  rhythm, time, onTimeChange, days, onToggleDay, monthDay, onMonthDayChange,
}: ComposerScheduleDetailFormProps) {
  const timeId = useId();
  const { t } = useTranslation();
  const dayOptions = useDayOptions();
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-3">
        <label htmlFor={timeId} className="typo-label text-foreground/90 w-20">{t.agents.glyph_sched_time_label}</label>
        <input
          id={timeId}
          type="time"
          value={time}
          onChange={(e) => onTimeChange(e.target.value)}
          autoFocus
          className="flex-1 max-w-[200px] px-3 py-2 rounded-interactive bg-foreground/5 border border-border/40 typo-body-lg text-foreground focus:outline-none focus:border-primary/50"
        />
      </div>

      {rhythm === "weekly" && (
        <div className="flex flex-col gap-2">
          <label className="typo-label text-foreground/90">{t.agents.glyph_sched_days_label}</label>
          <div className="flex gap-1.5 flex-wrap">
            {dayOptions.map((d) => {
              const active = days.includes(d.id);
              return (
                <button
                  key={d.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => onToggleDay(d.id)}
                  className={`px-3 py-2 rounded-interactive typo-body transition-colors ${
                    active
                      ? "bg-primary/30 text-foreground border border-primary/50"
                      : "bg-foreground/5 text-foreground border border-border/30 hover:border-primary/30 hover:text-foreground"
                  }`}
                >
                  {d.short}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {rhythm === "monthly" && (
        <div className="flex flex-col gap-2">
          <label className="typo-label text-foreground/90"><DebtText k="auto_day_of_month_f5dbae0b" /></label>
          <div className="grid grid-cols-7 gap-1.5">
            {Array.from({ length: 28 }, (_, i) => i + 1).map((n) => {
              const active = monthDay === n;
              return (
                <button
                  key={n}
                  type="button"
                  aria-pressed={active}
                  onClick={() => onMonthDayChange(n)}
                  className={`h-10 rounded-interactive typo-body transition-colors tabular-nums ${
                    active
                      ? "bg-primary/30 text-foreground border border-primary/50"
                      : "bg-foreground/5 text-foreground border border-border/25 hover:border-primary/30 hover:text-foreground"
                  }`}
                >
                  {n}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
