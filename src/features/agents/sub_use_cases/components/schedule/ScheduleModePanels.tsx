import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { SCHEDULE_PRESETS } from '../../libs/scheduleHelpers';
import type { CronPreview } from '@/api/pipeline/triggers';
import { DayTimeGrid } from './DayTimeGrid';
import { useTranslation } from '@/i18n/useTranslation';

const ANIM = { initial: { opacity: 0, y: -4 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: -4 }, transition: { duration: 0.15 } };

interface PresetPanelProps {
  cronExpression: string;
  onSelect: (cron: string) => void;
}

export function PresetPanel({ cronExpression, onSelect }: PresetPanelProps) {
  return (
    <div key="presets" {...ANIM} className="animate-fade-in space-y-2">
      <div className="grid grid-cols-2 gap-1.5">
        {SCHEDULE_PRESETS.map((preset) => {
          const active = cronExpression === preset.cron;
          return (
            <button
              key={preset.cron}
              type="button"
              onClick={() => onSelect(preset.cron)}
              className={`text-left px-2.5 py-2 rounded-modal typo-body transition-all border ${
                active
                  ? 'bg-amber-500/12 text-amber-300 border-amber-500/25 font-medium'
                  : 'bg-secondary/20 text-foreground border-primary/10 hover:border-primary/20 hover:text-foreground/80'
              }`}
            >
              <span className="block">{preset.label}</span>
              <span className={`typo-code font-mono mt-0.5 block ${active ? 'text-amber-400/60' : 'text-foreground'}`}>
                {preset.cron}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

interface VisualPanelProps {
  selectedDays: Set<string>;
  hour: number;
  minute: number;
  onToggleDay: (day: string) => void;
  onHourChange: (h: number) => void;
  onMinuteChange: (m: number) => void;
}

export function VisualPanel({ selectedDays, hour, minute, onToggleDay, onHourChange, onMinuteChange }: VisualPanelProps) {
  return (
    <div className="animate-fade-in" key="visual" {...ANIM}>
      <DayTimeGrid
        selectedDays={selectedDays}
        hour={hour}
        minute={minute}
        onToggleDay={onToggleDay}
        onHourChange={onHourChange}
        onMinuteChange={onMinuteChange}
      />
    </div>
  );
}

interface CronPanelProps {
  cronExpression: string;
  onCronChange: (expr: string) => void;
  cronPreview: CronPreview | null;
  cronLoading: boolean;
}

export function CronPanel({ cronExpression, onCronChange, cronPreview, cronLoading }: CronPanelProps) {
  const { t } = useTranslation();
  return (
    <div key="cron" {...ANIM} className="animate-fade-in space-y-2">
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={cronExpression}
          onChange={(e) => onCronChange(e.target.value)}
          placeholder={t.agents.use_cases.cron_placeholder}
          className={`flex-1 px-3 py-2 bg-background/50 border rounded-modal text-foreground font-mono typo-code placeholder-muted-foreground/30 focus-visible:outline-none focus-visible:ring-2 transition-all ${
            cronPreview && !cronPreview.valid
              ? 'border-red-500/30 ring-1 ring-red-500/20 focus-visible:ring-red-500/30'
              : 'border-primary/20 focus-visible:ring-amber-500/30'
          }`}
        />
        {cronLoading && <LoadingSpinner className="text-amber-400/60 flex-shrink-0" />}
      </div>
      <div className="flex gap-3 typo-code text-foreground font-mono px-0.5">
        <span>{t.agents.use_cases.cron_field_min}</span><span>{t.agents.use_cases.cron_field_hour}</span><span>{t.agents.use_cases.cron_field_day}</span><span>{t.agents.use_cases.cron_field_month}</span><span>{t.agents.use_cases.cron_field_weekday}</span>
      </div>
      {cronPreview && !cronPreview.valid && (
        <p className="typo-body text-red-400/80">{cronPreview.error}</p>
      )}
      {cronPreview?.valid && (
        <p className="typo-body text-amber-400/80 font-medium">{cronPreview.description}</p>
      )}
    </div>
  );
}
