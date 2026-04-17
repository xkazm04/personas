import { type Frequency, DAYS, MONTH_DAYS, INPUT_CLS } from './quickConfigTypes';
import { useTranslation } from '@/i18n/useTranslation';

interface SchedulePanelProps {
  frequency: Frequency | null;
  setFrequency: (f: Frequency) => void;
  days: string[];
  setDays: (d: string[]) => void;
  monthDay: number;
  setMonthDay: (d: number) => void;
  time: string;
  setTime: (t: string) => void;
}

export function SchedulePanel({
  frequency, setFrequency,
  days, setDays,
  monthDay, setMonthDay,
  time, setTime,
}: SchedulePanelProps) {
  const { t } = useTranslation();
  const toggleDay = (day: string) => {
    setDays(days.includes(day) ? days.filter((d) => d !== day) : [...days, day]);
  };

  return (
    <div className="grid grid-cols-[auto_auto_auto] items-start gap-x-6 gap-y-0 px-1" style={{ gridTemplateColumns: 'repeat(auto-fill, auto)' }}>
      <div className="flex flex-wrap items-end gap-6">
        {/* Frequency */}
        <div className="flex flex-col gap-2">
          <span className="text-[10px] font-semibold text-foreground uppercase tracking-wider">{t.agents.quick_config.frequency}</span>
          <div className="flex items-center gap-1 p-0.5 rounded-card bg-secondary/20 h-9">
            {(['daily', 'weekly', 'monthly'] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFrequency(f)}
                className={`px-3.5 h-8 rounded-input typo-caption font-medium transition-all duration-200 ${
                  frequency === f
                    ? 'bg-primary/15 text-primary shadow-elevation-1'
                    : 'text-foreground hover:text-muted-foreground/70'
                }`}
              >
                {f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {/* Day selection (weekly) */}
        {frequency === 'weekly' && (
          <div className="flex flex-col gap-2">
            <span className="text-[10px] font-semibold text-foreground uppercase tracking-wider">{t.agents.quick_config.days}</span>
            <div className="flex items-center gap-1 h-9">
              {DAYS.map((day) => (
                <button
                  key={day.key}
                  type="button"
                  onClick={() => toggleDay(day.key)}
                  className={`w-9 h-9 rounded-card typo-caption font-semibold transition-all duration-200 ${
                    days.includes(day.key)
                      ? 'bg-primary/20 text-primary border border-primary/30'
                      : 'bg-secondary/15 text-foreground border border-transparent hover:border-primary/15'
                  }`}
                >
                  {day.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Day of month (monthly) */}
        {frequency === 'monthly' && (
          <div className="flex flex-col gap-2">
            <span className="text-[10px] font-semibold text-foreground uppercase tracking-wider">{t.agents.quick_config.day_of_month}</span>
            <select
              value={monthDay}
              onChange={(e) => setMonthDay(Number(e.target.value))}
              className={INPUT_CLS}
            >
              {MONTH_DAYS.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </div>
        )}

        {/* Time picker */}
        {frequency && (
          <div className="flex flex-col gap-2">
            <span className="text-[10px] font-semibold text-foreground uppercase tracking-wider">{t.agents.quick_config.time}</span>
            <input
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              className={INPUT_CLS}
            />
          </div>
        )}
      </div>
    </div>
  );
}
