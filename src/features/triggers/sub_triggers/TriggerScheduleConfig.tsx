import { formatInterval } from '@/lib/utils/formatters';
import { type CronPreview } from '@/api/pipeline/triggers';
import { SchedulePreview, CronSchedulePreview } from './TriggerSchedulePreview';
import { useTranslation } from '@/i18n/useTranslation';

export function IntervalConfig({
  interval,
  setInterval: setIntervalValue,
  customInterval,
  setCustomInterval,
  validationError,
  setValidationError,
  triggerType,
}: {
  interval: string;
  setInterval: (v: string) => void;
  customInterval: boolean;
  setCustomInterval: (v: boolean) => void;
  validationError: string | null;
  setValidationError: (v: string | null) => void;
  triggerType: string;
}) {
  const { t } = useTranslation();
  return (
    <div>
      <label className="block typo-body font-medium text-foreground mb-1.5">
        {t.triggers.schedule.interval_label}
      </label>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {([
          { label: '1 min', value: '60' },
          { label: '5 min', value: '300' },
          { label: '15 min', value: '900' },
          { label: '1 hour', value: '3600' },
          { label: '6 hours', value: '21600' },
          { label: '24 hours', value: '86400' },
        ] as const).map((preset) => (
          <button
            key={preset.value}
            type="button"
            onClick={() => { setIntervalValue(preset.value); setCustomInterval(false); }}
            className={`px-3 py-1.5 rounded-modal typo-body font-medium transition-all border ${
              !customInterval && interval === preset.value
                ? 'bg-primary/15 text-primary border-primary/30'
                : 'bg-secondary/30 text-foreground border-border/30 hover:text-muted-foreground hover:bg-secondary/50'
            }`}
          >
            {preset.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setCustomInterval(true)}
          className={`px-3 py-1.5 rounded-modal typo-body font-medium transition-all border ${
            customInterval
              ? 'bg-primary/15 text-primary border-primary/30'
              : 'bg-secondary/30 text-foreground border-border/30 hover:text-muted-foreground hover:bg-secondary/50'
          }`}
        >
          Custom
        </button>
      </div>
      {customInterval && (
        <>
          <input
            type="number"
            value={interval}
            onChange={(e) => {
              setIntervalValue(e.target.value);
              if (validationError) setValidationError(null);
            }}
            min="60"
            placeholder="Seconds (min 60)"
            aria-invalid={!!validationError}
            aria-describedby={validationError ? 'interval-error' : undefined}
            className={`w-full px-3 py-2 bg-background/50 border rounded-modal text-foreground font-mono typo-code focus-ring transition-all ${
              validationError
                ? 'border-red-500/30 ring-1 ring-red-500/30'
                : 'border-primary/15 focus-visible:border-primary/40'
            }`}
          />
          {validationError && (
            <p id="interval-error" className="typo-body text-red-400/80 mt-1">{validationError}</p>
          )}
          {!validationError && (() => {
            const secs = parseInt(interval) || 0;
            if (secs < 60) return null;
            return (
              <p className="typo-body text-primary/60 mt-1">Every {formatInterval(secs)}</p>
            );
          })()}
        </>
      )}
      {(() => {
        const secs = parseInt(interval) || 0;
        if (secs < 60) return null;
        const runsPerDay = Math.floor(86400 / secs);
        return (
          <>
            <p className="typo-body text-foreground mt-1.5">
              {t.triggers.this_persona_will} {triggerType === 'polling' ? 'poll' : 'run'} every{' '}
              <span className="text-foreground font-medium">{formatInterval(secs)}</span>
              {t.triggers.starting_from}{' '}
              <span className="text-foreground">
                Approximately {runsPerDay.toLocaleString()} run{runsPerDay !== 1 ? 's' : ''} {t.triggers.per_day}
              </span>
            </p>
            <SchedulePreview intervalSeconds={secs} triggerType={triggerType} />
          </>
        );
      })()}
    </div>
  );
}

const CRON_PRESETS = [
  { label: 'Every minute', value: '* * * * *' },
  { label: 'Hourly', value: '0 * * * *' },
  { label: 'Daily 9 AM', value: '0 9 * * *' },
  { label: 'Daily midnight', value: '0 0 * * *' },
  { label: 'Weekdays 9 AM', value: '0 9 * * 1-5' },
  { label: 'Weekly Mon', value: '0 0 * * 1' },
  { label: 'Monthly 1st', value: '0 0 1 * *' },
  { label: 'Every 6h', value: '0 */6 * * *' },
];

export function CronConfig({
  cronExpression,
  setCronExpression,
  cronPreview,
  cronLoading,
  validationError,
  onPresetSelect,
}: {
  cronExpression: string;
  setCronExpression: (v: string) => void;
  cronPreview: CronPreview | null;
  cronLoading: boolean;
  validationError: string | null;
  onPresetSelect: (expr: string) => void;
}) {
  const { t } = useTranslation();
  const hasError = cronPreview && !cronPreview.valid;

  return (
    <div className="space-y-3">
      {/* Presets */}
      <div>
        <label className="block typo-body font-medium text-foreground mb-1.5">
          {t.triggers.quick_presets_label}
        </label>
        <div className="flex flex-wrap gap-1.5">
          {CRON_PRESETS.map((p) => (
            <button
              key={p.value}
              type="button"
              onClick={() => onPresetSelect(p.value)}
              className={`px-2.5 py-1 rounded-modal typo-body transition-all border ${
                cronExpression === p.value
                  ? 'bg-amber-500/15 text-amber-400 border-amber-500/30 font-medium'
                  : 'bg-secondary/30 text-foreground border-border/30 hover:text-muted-foreground hover:bg-secondary/50'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Expression input */}
      <div>
        <label className="block typo-body font-medium text-foreground mb-1.5">
          {t.triggers.cron_expression_label}
        </label>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={cronExpression}
            onChange={(e) => setCronExpression(e.target.value)}
            placeholder="* * * * *  (min hour dom mon dow)"
            aria-invalid={!!(hasError || validationError)}
            aria-describedby={validationError ? 'cron-validation-error' : hasError ? 'cron-preview-error' : undefined}
            className={`flex-1 px-3 py-2 bg-background/50 border rounded-modal text-foreground font-mono typo-code placeholder-muted-foreground/30 focus-ring transition-all ${
              hasError || validationError
                ? 'border-red-500/30 ring-1 ring-red-500/30'
                : 'border-primary/15 focus-visible:border-amber-500/40'
            }`}
          />
          {cronLoading && (
            <div className="w-4 h-4 border-2 border-amber-400/30 border-t-amber-400 rounded-full animate-spin" />
          )}
        </div>

        {/* Validation error */}
        {validationError && (
          <p id="cron-validation-error" className="typo-body text-red-400/80 mt-1">{validationError}</p>
        )}
        {hasError && !validationError && (
          <p id="cron-preview-error" className="typo-body text-red-400/80 mt-1">{cronPreview?.error}</p>
        )}

        {/* Human description */}
        {cronPreview?.valid && (
          <p className="typo-body text-amber-400/80 mt-1.5 font-medium">
            {cronPreview.description}
          </p>
        )}

        {/* Field legend */}
        <div className="flex items-center gap-3 mt-2 typo-code text-foreground font-mono">
          <span>min</span>
          <span>hour</span>
          <span>day</span>
          <span>month</span>
          <span>weekday</span>
          <span className="ml-auto text-amber-400/60 typo-caption font-sans font-medium">{t.triggers.local_time}</span>
        </div>
      </div>

      {/* Next-runs timeline preview */}
      {cronPreview?.valid && cronPreview.next_runs.length > 0 && (
        <CronSchedulePreview cronPreview={cronPreview} />
      )}
    </div>
  );
}
