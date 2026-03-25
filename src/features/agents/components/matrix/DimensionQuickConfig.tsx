import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { Clock, Plug, ChevronUp, ChevronDown, Check, Zap } from 'lucide-react';
import { ConnectorIcon } from '@/features/shared/components/display/ConnectorMeta';
import { useHealthyConnectors, type HealthyConnector } from './useHealthyConnectors';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Frequency = 'daily' | 'weekly' | 'monthly';

const DAYS = [
  { key: 'mon', label: 'M' },
  { key: 'tue', label: 'T' },
  { key: 'wed', label: 'W' },
  { key: 'thu', label: 'T' },
  { key: 'fri', label: 'F' },
  { key: 'sat', label: 'S' },
  { key: 'sun', label: 'S' },
] as const;

const DAY_LABELS: Record<string, string> = {
  mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday',
  fri: 'Friday', sat: 'Saturday', sun: 'Sunday',
};

const MONTH_DAYS = Array.from({ length: 28 }, (_, i) => i + 1);

const INPUT_CLS = 'h-9 px-3 rounded-lg border border-primary/15 bg-secondary/20 text-sm text-foreground/80 outline-none focus-visible:border-primary/30 transition-colors';

export interface QuickConfigState {
  frequency: Frequency | null;
  days: string[];
  monthDay: number;
  time: string;
  selectedConnectors: string[];
}

export function serializeQuickConfig(state: QuickConfigState): string {
  const parts: string[] = [];

  if (state.frequency) {
    let schedule = '';
    if (state.frequency === 'daily') {
      schedule = `Daily at ${state.time || '09:00'}`;
    } else if (state.frequency === 'weekly') {
      const dayNames = state.days.map((d) => DAY_LABELS[d] ?? d).join(', ');
      schedule = `Weekly on ${dayNames || 'Monday'} at ${state.time || '09:00'}`;
    } else {
      schedule = `Monthly on day ${state.monthDay} at ${state.time || '09:00'}`;
    }
    parts.push(`Schedule: ${schedule}`);
  }

  if (state.selectedConnectors.length > 0) {
    parts.push(`Services: ${state.selectedConnectors.join(', ')}`);
  }

  return parts.length > 0 ? `\n---\n${parts.join('\n')}` : '';
}

/** Build human-readable trigger summary for cell preview */
export function describeTriggerConfig(state: QuickConfigState): string[] {
  if (!state.frequency) return [];
  const lines: string[] = [];
  if (state.frequency === 'daily') {
    lines.push(`Daily at ${state.time || '09:00'}`);
  } else if (state.frequency === 'weekly') {
    const dayNames = state.days.map((d) => DAY_LABELS[d] ?? d);
    lines.push(`Weekly: ${dayNames.join(', ') || 'Monday'}`);
    lines.push(`At ${state.time || '09:00'}`);
  } else {
    lines.push(`Monthly on day ${state.monthDay}`);
    lines.push(`At ${state.time || '09:00'}`);
  }
  return lines;
}

/** Build connector label list for cell preview */
export function describeSelectedConnectors(
  state: QuickConfigState,
  connectors: HealthyConnector[],
): string[] {
  return state.selectedConnectors.map((name) => {
    const c = connectors.find((h) => h.name === name);
    return c?.meta.label ?? name;
  });
}

// ---------------------------------------------------------------------------
// Schedule panel — label top, input bottom layout
// ---------------------------------------------------------------------------

function SchedulePanel({
  frequency, setFrequency,
  days, setDays,
  monthDay, setMonthDay,
  time, setTime,
}: {
  frequency: Frequency | null; setFrequency: (f: Frequency) => void;
  days: string[]; setDays: (d: string[]) => void;
  monthDay: number; setMonthDay: (d: number) => void;
  time: string; setTime: (t: string) => void;
}) {
  const toggleDay = (day: string) => {
    setDays(days.includes(day) ? days.filter((d) => d !== day) : [...days, day]);
  };

  return (
    <div className="grid grid-cols-[auto_auto_auto] items-start gap-x-6 gap-y-0 px-1" style={{ gridTemplateColumns: 'repeat(auto-fill, auto)' }}>
      <div className="flex flex-wrap items-end gap-6">
        {/* Frequency */}
        <div className="flex flex-col gap-2">
          <span className="text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-wider">Frequency</span>
          <div className="flex items-center gap-1 p-0.5 rounded-lg bg-secondary/20 h-9">
            {(['daily', 'weekly', 'monthly'] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFrequency(f)}
                className={`px-3.5 h-8 rounded-md text-xs font-medium transition-all duration-200 ${
                  frequency === f
                    ? 'bg-primary/15 text-primary shadow-sm'
                    : 'text-muted-foreground/50 hover:text-muted-foreground/70'
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
            <span className="text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-wider">Days</span>
            <div className="flex items-center gap-1 h-9">
              {DAYS.map((day) => (
                <button
                  key={day.key}
                  type="button"
                  onClick={() => toggleDay(day.key)}
                  className={`w-9 h-9 rounded-lg text-xs font-semibold transition-all duration-200 ${
                    days.includes(day.key)
                      ? 'bg-primary/20 text-primary border border-primary/30'
                      : 'bg-secondary/15 text-muted-foreground/50 border border-transparent hover:border-primary/15'
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
            <span className="text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-wider">Day of Month</span>
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
            <span className="text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-wider">Time</span>
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

// ---------------------------------------------------------------------------
// Services panel
// ---------------------------------------------------------------------------

function ServicesPanel({
  connectors,
  selectedConnectors,
  onToggle,
}: {
  connectors: HealthyConnector[];
  selectedConnectors: string[];
  onToggle: (name: string) => void;
}) {
  const [activeCategory, setActiveCategory] = useState('all');

  // Derive available categories from connectors that are present, sorted alphabetically
  const categories = useMemo(() => {
    const cats = new Set<string>();
    for (const c of connectors) {
      if (c.category) cats.add(c.category);
    }
    return Array.from(cats).sort((a, b) => a.localeCompare(b));
  }, [connectors]);

  // Filter + sort connectors
  const filtered = useMemo(() => {
    const list = activeCategory === 'all'
      ? connectors
      : connectors.filter((c) => c.category === activeCategory);
    return [...list].sort((a, b) => a.meta.label.localeCompare(b.meta.label));
  }, [connectors, activeCategory]);

  if (connectors.length === 0) {
    return (
      <p className="text-xs text-muted-foreground/40 px-1 py-2">
        No connectors with healthy API keys found. Add credentials in the Vault first.
      </p>
    );
  }

  return (
    <div className="space-y-3 px-1">
      {/* Category filter strip */}
      <div className="flex items-center gap-1 overflow-x-auto scrollbar-none">
        <button
          type="button"
          onClick={() => setActiveCategory('all')}
          className={`px-2.5 py-1 rounded-md text-[10px] font-semibold uppercase tracking-wider whitespace-nowrap transition-all duration-200 ${
            activeCategory === 'all'
              ? 'bg-primary/15 text-primary'
              : 'text-muted-foreground/40 hover:text-muted-foreground/60'
          }`}
        >
          All
        </button>
        {categories.map((cat) => (
          <button
            key={cat}
            type="button"
            onClick={() => setActiveCategory(cat)}
            className={`px-2.5 py-1 rounded-md text-[10px] font-semibold uppercase tracking-wider whitespace-nowrap transition-all duration-200 ${
              activeCategory === cat
                ? 'bg-primary/15 text-primary'
                : 'text-muted-foreground/40 hover:text-muted-foreground/60'
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Connector grid — fixed card size */}
      <div className="flex flex-wrap gap-2.5">
        {filtered.map((c) => {
          const isSelected = selectedConnectors.includes(c.name);
          return (
            <button
              key={c.name}
              type="button"
              onClick={() => onToggle(c.name)}
              className={`group relative flex flex-col items-center justify-center gap-1.5 rounded-xl transition-all duration-200 ${
                isSelected
                  ? 'bg-primary/10 border border-primary/25 shadow-sm shadow-primary/10'
                  : 'bg-secondary/10 border border-transparent hover:border-primary/15 hover:bg-secondary/20'
              }`}
              style={{ width: 100, height: 75 }}
            >
              {isSelected && (
                <div className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-emerald-500 flex items-center justify-center shadow-sm animate-fade-slide-in">
                  <Check className="w-2.5 h-2.5 text-white" strokeWidth={3} />
                </div>
              )}
              <div className={`w-7 h-7 flex items-center justify-center transition-all duration-200 ${
                isSelected ? 'scale-110' : 'group-hover:scale-105'
              }`}>
                <ConnectorIcon meta={c.meta} size="w-6 h-6" />
              </div>
              <span className={`text-[10px] font-medium truncate max-w-[88px] text-center leading-tight transition-colors ${
                isSelected ? 'text-foreground/80' : 'text-muted-foreground/50'
              }`}>
                {c.meta.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main toolbar overlay
// ---------------------------------------------------------------------------

interface DimensionQuickConfigProps {
  onChange: (state: QuickConfigState) => void;
}

export function DimensionQuickConfig({ onChange }: DimensionQuickConfigProps) {
  const healthyConnectors = useHealthyConnectors();
  const [collapsed, setCollapsed] = useState(false);
  const [openPanel, setOpenPanel] = useState<'schedule' | 'services' | null>(null);

  const [frequency, setFrequency] = useState<Frequency | null>(null);
  const [days, setDays] = useState<string[]>(['mon']);
  const [monthDay, setMonthDay] = useState(1);
  const [time, setTime] = useState('09:00');
  const [selectedConnectors, setSelectedConnectors] = useState<string[]>([]);

  // Notify parent on change
  useEffect(() => {
    onChange({ frequency, days, monthDay, time, selectedConnectors });
  }, [frequency, days, monthDay, time, selectedConnectors, onChange]);

  const toggleConnector = useCallback((name: string) => {
    setSelectedConnectors((prev) =>
      prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name],
    );
  }, []);

  const togglePanel = (panel: 'schedule' | 'services') => {
    setOpenPanel((prev) => (prev === panel ? null : panel));
  };

  // Animated panel height
  const scheduleRef = useRef<HTMLDivElement>(null);
  const servicesRef = useRef<HTMLDivElement>(null);
  const [scheduleHeight, setScheduleHeight] = useState(0);
  const [servicesHeight, setServicesHeight] = useState(0);

  useEffect(() => {
    if (openPanel === 'schedule' && scheduleRef.current) {
      setScheduleHeight(scheduleRef.current.scrollHeight);
    }
    if (openPanel === 'services' && servicesRef.current) {
      setServicesHeight(servicesRef.current.scrollHeight);
    }
  }, [openPanel, frequency, healthyConnectors.length]);

  return (
    <div className="w-full min-w-[1100px]">
      <div className="rounded-xl border border-primary/10 bg-white/[0.03] backdrop-blur-sm overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-2.5">
          <Zap className="w-3.5 h-3.5 text-amber-400/70 flex-shrink-0" />
          <span className="text-[11px] font-semibold text-muted-foreground/50 uppercase tracking-wider">Quick Setup</span>

          {!collapsed && (
            <div className="flex items-center gap-2 ml-2">
              <button
                type="button"
                onClick={() => togglePanel('schedule')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200 ${
                  openPanel === 'schedule'
                    ? 'bg-primary/15 text-primary border border-primary/25'
                    : 'bg-secondary/20 text-muted-foreground/60 border border-transparent hover:border-primary/15'
                }`}
              >
                <Clock className="w-3 h-3" />
                Schedule
              </button>

              <button
                type="button"
                onClick={() => togglePanel('services')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200 ${
                  openPanel === 'services'
                    ? 'bg-primary/15 text-primary border border-primary/25'
                    : 'bg-secondary/20 text-muted-foreground/60 border border-transparent hover:border-primary/15'
                }`}
              >
                <Plug className="w-3 h-3" />
                Apps & Services
              </button>
            </div>
          )}

          <button
            type="button"
            onClick={() => { setCollapsed(!collapsed); setOpenPanel(null); }}
            className="ml-auto text-muted-foreground/30 hover:text-muted-foreground/60 transition-colors p-1"
          >
            {collapsed ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
          </button>
        </div>

        {/* Schedule dropdown panel */}
        <div
          className="transition-[max-height,opacity] duration-250 ease-out overflow-hidden"
          style={{
            maxHeight: openPanel === 'schedule' ? scheduleHeight : 0,
            opacity: openPanel === 'schedule' ? 1 : 0,
          }}
        >
          <div ref={scheduleRef} className="border-t border-primary/8 px-4 py-4">
            <SchedulePanel
              frequency={frequency} setFrequency={setFrequency}
              days={days} setDays={setDays}
              monthDay={monthDay} setMonthDay={setMonthDay}
              time={time} setTime={setTime}
            />
          </div>
        </div>

        {/* Services dropdown panel */}
        <div
          className="transition-[max-height,opacity] duration-250 ease-out overflow-hidden"
          style={{
            maxHeight: openPanel === 'services' ? servicesHeight : 0,
            opacity: openPanel === 'services' ? 1 : 0,
          }}
        >
          <div ref={servicesRef} className="border-t border-primary/8 px-4 py-4">
            <ServicesPanel
              connectors={healthyConnectors}
              selectedConnectors={selectedConnectors}
              onToggle={toggleConnector}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
