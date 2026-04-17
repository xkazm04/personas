import { useState, useCallback, useMemo } from 'react';
import { Clock, ChevronDown, ChevronRight, Globe } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
const DAYS = [
  { key: 0, label: 'Sun', short: 'S' },
  { key: 1, label: 'Mon', short: 'M' },
  { key: 2, label: 'Tue', short: 'T' },
  { key: 3, label: 'Wed', short: 'W' },
  { key: 4, label: 'Thu', short: 'T' },
  { key: 5, label: 'Fri', short: 'F' },
  { key: 6, label: 'Sat', short: 'S' },
] as const;

const WEEKDAY_PRESET = [1, 2, 3, 4, 5];
const EVERYDAY_PRESET = [0, 1, 2, 3, 4, 5, 6];

export interface ActiveWindowConfig {
  enabled: boolean;
  days: number[];
  start_hour: number;
  start_minute: number;
  end_hour: number;
  end_minute: number;
  /** IANA timezone name (e.g. "America/New_York"). When absent, system local is used. */
  timezone?: string;
}

const DEFAULT_ACTIVE_WINDOW: ActiveWindowConfig = {
  enabled: false,
  days: WEEKDAY_PRESET,
  start_hour: 9,
  start_minute: 0,
  end_hour: 18,
  end_minute: 0,
};

/** Resolve the display name for the active timezone. */
function resolvedTimezoneLabel(tz?: string): string {
  if (tz) return tz;
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return 'Local';
  }
}

function parseActiveWindow(config: Record<string, unknown>): ActiveWindowConfig {
  const raw = config.active_window as Record<string, unknown> | undefined;
  if (!raw) return { ...DEFAULT_ACTIVE_WINDOW };
  return {
    enabled: Boolean(raw.enabled),
    days: Array.isArray(raw.days) ? (raw.days as number[]) : WEEKDAY_PRESET,
    start_hour: typeof raw.start_hour === 'number' ? raw.start_hour : 9,
    start_minute: typeof raw.start_minute === 'number' ? raw.start_minute : 0,
    end_hour: typeof raw.end_hour === 'number' ? raw.end_hour : 18,
    end_minute: typeof raw.end_minute === 'number' ? raw.end_minute : 0,
    timezone: typeof raw.timezone === 'string' ? raw.timezone : undefined,
  };
}

function formatTime(hour: number, minute: number): string {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function timeToInput(hour: number, minute: number): string {
  return formatTime(hour, minute);
}

interface ActiveHoursSectionProps {
  config: Record<string, unknown>;
  onChange: (updated: Record<string, unknown>) => void;
}

export function ActiveHoursSection({ config, onChange }: ActiveHoursSectionProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const aw = useMemo(() => parseActiveWindow(config), [config]);

  const update = useCallback(
    (patch: Partial<ActiveWindowConfig>) => {
      const next = { ...aw, ...patch };
      onChange({ ...config, active_window: next });
    },
    [aw, config, onChange],
  );

  const toggleDay = useCallback(
    (day: number) => {
      const next = aw.days.includes(day)
        ? aw.days.filter((d) => d !== day)
        : [...aw.days, day].sort((a, b) => a - b);
      update({ days: next });
    },
    [aw.days, update],
  );

  const applyPreset = useCallback(
    (preset: number[]) => {
      update({ days: [...preset] });
    },
    [update],
  );

  const isWeekdays = useMemo(
    () => aw.days.length === 5 && WEEKDAY_PRESET.every((d) => aw.days.includes(d)),
    [aw.days],
  );
  const isEveryday = useMemo(
    () => aw.days.length === 7,
    [aw.days],
  );

  const tzLabel = resolvedTimezoneLabel(aw.timezone);
  const summaryLabel = aw.enabled
    ? `${isWeekdays ? 'Weekdays' : isEveryday ? 'Every day' : `${aw.days.length} days`} ${formatTime(aw.start_hour, aw.start_minute)}–${formatTime(aw.end_hour, aw.end_minute)} ${tzLabel}`
    : null;

  return (
    <div className="space-y-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 w-full typo-body text-foreground hover:text-muted-foreground transition-colors"
      >
        {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        <Clock className="w-3 h-3" />
        {t.triggers.active_hours}
        {aw.enabled && (
          <span className="ml-1 px-1.5 py-0.5 rounded-full typo-body bg-sky-500/15 text-sky-400 font-medium">
            {summaryLabel}
          </span>
        )}
      </button>

      {expanded && (
          <div
            className="animate-fade-slide-in overflow-hidden"
          >
            <div className="space-y-3 pl-5 pt-1">
              {/* Enable toggle */}
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={aw.enabled}
                  onChange={(e) => update({ enabled: e.target.checked })}
                  className="accent-sky-500"
                />
                <span className="typo-body text-foreground">
                  {t.triggers.only_fire_during_active}
                </span>
              </label>

              {aw.enabled && (
                <>
                  {/* Day toggles */}
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-1">
                      {DAYS.map((d) => (
                        <button
                          key={d.key}
                          onClick={() => toggleDay(d.key)}
                          title={d.label}
                          className={`w-7 h-7 rounded-card typo-caption font-medium transition-colors ${
                            aw.days.includes(d.key)
                              ? 'bg-sky-500/20 text-sky-400 border border-sky-500/30'
                              : 'bg-secondary/30 text-foreground border border-primary/5 hover:border-primary/15'
                          }`}
                        >
                          {d.short}
                        </button>
                      ))}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => applyPreset(WEEKDAY_PRESET)}
                        className={`px-2 py-0.5 typo-caption rounded-input transition-colors ${
                          isWeekdays
                            ? 'bg-sky-500/15 text-sky-400'
                            : 'text-foreground hover:text-muted-foreground/70 bg-secondary/20'
                        }`}
                      >
                        Weekdays
                      </button>
                      <button
                        onClick={() => applyPreset(EVERYDAY_PRESET)}
                        className={`px-2 py-0.5 typo-caption rounded-input transition-colors ${
                          isEveryday
                            ? 'bg-sky-500/15 text-sky-400'
                            : 'text-foreground hover:text-muted-foreground/70 bg-secondary/20'
                        }`}
                      >
                        Every day
                      </button>
                    </div>
                  </div>

                  {/* Time range */}
                  <div className="flex items-center gap-2">
                    <input
                      type="time"
                      value={timeToInput(aw.start_hour, aw.start_minute)}
                      onChange={(e) => {
                        const [h, m] = e.target.value.split(':').map(Number);
                        update({ start_hour: h, start_minute: m });
                      }}
                      className="px-2 py-1 typo-body bg-background/50 border border-primary/10 rounded-card text-foreground focus-ring"
                    />
                    <span className="text-foreground typo-caption">to</span>
                    <input
                      type="time"
                      value={timeToInput(aw.end_hour, aw.end_minute)}
                      onChange={(e) => {
                        const [h, m] = e.target.value.split(':').map(Number);
                        update({ end_hour: h, end_minute: m });
                      }}
                      className="px-2 py-1 typo-body bg-background/50 border border-primary/10 rounded-card text-foreground focus-ring"
                    />
                  </div>

                  {/* Timezone */}
                  <div className="flex items-center gap-2">
                    <Globe className="w-3 h-3 text-foreground" />
                    <input
                      type="text"
                      value={aw.timezone ?? ''}
                      placeholder={resolvedTimezoneLabel()}
                      onChange={(e) => {
                        const val = e.target.value.trim();
                        update({ timezone: val || undefined });
                      }}
                      className="px-2 py-1 typo-body bg-background/50 border border-primary/10 rounded-card text-foreground focus-ring w-48"
                    />
                    <span className="text-foreground typo-caption">
                      {aw.timezone ? aw.timezone : `System: ${resolvedTimezoneLabel()}`}
                    </span>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
    </div>
  );
}
