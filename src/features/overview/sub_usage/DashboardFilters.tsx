import { useState, useRef, useEffect } from 'react';
import { Calendar } from 'lucide-react';
import type { Persona } from '@/lib/bindings/Persona';
import { ThemedSelect } from '@/features/shared/components/forms/ThemedSelect';
import type { OverviewDayRange, CustomDateRange } from '@/features/overview/components/dashboard/OverviewFilterContext';

// ---------------------------------------------------------------------------
// DayRangePicker
// ---------------------------------------------------------------------------

export type DayRange = OverviewDayRange;

const DAY_OPTIONS: Array<{ value: DayRange; label: string }> = [
  { value: 1, label: '24h' },
  { value: 7, label: '7d' },
  { value: 30, label: '30d' },
  { value: 90, label: '90d' },
];

interface DayRangePickerProps {
  value: DayRange;
  onChange: (days: DayRange) => void;
  customDateRange?: CustomDateRange | null;
  onCustomDateRangeChange?: (range: CustomDateRange | null) => void;
}

export function DayRangePicker({ value, onChange, customDateRange, onCustomDateRangeChange }: DayRangePickerProps) {
  const [showCustom, setShowCustom] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const isCustomActive = customDateRange != null;

  useEffect(() => {
    if (!showCustom) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (
        popoverRef.current && !popoverRef.current.contains(e.target as Node) &&
        buttonRef.current && !buttonRef.current.contains(e.target as Node)
      ) {
        setShowCustom(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showCustom]);

  const handlePresetClick = (days: DayRange) => {
    onChange(days);
    setShowCustom(false);
  };

  const handleCustomClick = () => {
    setShowCustom((prev) => !prev);
  };

  const formatRangeLabel = (range: CustomDateRange): string => {
    const fmt = (iso: string) => {
      const d = new Date(iso + 'T00:00:00');
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    };
    return `${fmt(range[0])} -- ${fmt(range[1])}`;
  };

  return (
    <div className="relative">
      <div role="group" aria-label="Time range" className="flex items-center gap-1 p-1 bg-secondary/50 backdrop-blur-md rounded-modal border border-primary/20">
        {DAY_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => handlePresetClick(opt.value)}
            aria-pressed={!isCustomActive && value === opt.value}
            className={`px-3 py-1 rounded-modal text-sm font-medium transition-all ${
              !isCustomActive && value === opt.value
                ? 'bg-background text-foreground shadow-elevation-1 border border-primary/20'
                : 'text-foreground hover:text-muted-foreground'
            } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-2 focus-visible:ring-offset-background`}
          >
            {opt.label}
          </button>
        ))}
        <button
          ref={buttonRef}
          onClick={handleCustomClick}
          aria-pressed={isCustomActive}
          className={`px-3 py-1 rounded-modal text-sm font-medium transition-all flex items-center gap-1.5 ${
            isCustomActive
              ? 'bg-background text-foreground shadow-elevation-1 border border-primary/20'
              : 'text-foreground hover:text-muted-foreground'
          } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-2 focus-visible:ring-offset-background`}
        >
          <Calendar className="w-3 h-3" />
          {isCustomActive ? formatRangeLabel(customDateRange) : 'Custom'}
        </button>
      </div>

      {showCustom && onCustomDateRangeChange && (
        <DateRangePopover
          ref={popoverRef}
          value={customDateRange ?? null}
          onChange={(range) => {
            onCustomDateRangeChange(range);
            if (range) setShowCustom(false);
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// DateRangePopover
// ---------------------------------------------------------------------------

import { forwardRef } from 'react';
import { useTranslation } from '@/i18n/useTranslation';

interface DateRangePopoverProps {
  value: CustomDateRange | null;
  onChange: (range: CustomDateRange | null) => void;
}

const DateRangePopover = forwardRef<HTMLDivElement, DateRangePopoverProps>(
  function DateRangePopover({ value, onChange }, ref) {
    const { t } = useTranslation();
    const today = new Date().toISOString().slice(0, 10);
    const [startDate, setStartDate] = useState(value?.[0] ?? '');
    const [endDate, setEndDate] = useState(value?.[1] ?? today);

    const handleApply = () => {
      if (startDate && endDate && startDate <= endDate) {
        onChange([startDate, endDate]);
      }
    };

    const isValid = startDate !== '' && endDate !== '' && startDate <= endDate;

    const dayCount = isValid
      ? Math.max(1, Math.ceil((new Date(endDate).getTime() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24)))
      : 0;

    return (
      <div
        ref={ref}
        className="absolute top-full right-0 mt-2 z-50 bg-background/95 backdrop-blur-md border border-primary/20 rounded-modal shadow-elevation-3 p-4 min-w-[280px]"
      >
        <div className="space-y-3">
          <div>
            <label className="block text-sm text-foreground mb-1">{t.overview.filters.start_date}</label>
            <input
              type="date"
              value={startDate}
              max={endDate || today}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full px-3 py-1.5 text-sm rounded-card bg-secondary/50 border border-primary/15 text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/50 focus-visible:border-blue-400/50"
            />
          </div>
          <div>
            <label className="block text-sm text-foreground mb-1">{t.overview.filters.end_date}</label>
            <input
              type="date"
              value={endDate}
              min={startDate}
              max={today}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full px-3 py-1.5 text-sm rounded-card bg-secondary/50 border border-primary/15 text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/50 focus-visible:border-blue-400/50"
            />
          </div>
          {isValid && (
            <p className="text-sm text-foreground">
              {dayCount} day{dayCount !== 1 ? 's' : ''} selected
            </p>
          )}
          <div className="flex items-center gap-2">
            <button
              onClick={handleApply}
              disabled={!isValid}
              className="flex-1 px-3 py-1.5 text-sm font-medium rounded-card bg-blue-500/15 text-blue-300 border border-blue-500/25 hover:bg-blue-500/25 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Apply
            </button>
            {value && (
              <button
                onClick={() => onChange(null)}
                className="px-3 py-1.5 text-sm font-medium rounded-card text-foreground hover:text-muted-foreground hover:bg-secondary/50 transition-colors"
              >
                Clear
              </button>
            )}
          </div>
        </div>
      </div>
    );
  },
);

// ---------------------------------------------------------------------------
// CompareToggle
// ---------------------------------------------------------------------------

interface CompareToggleProps {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
}

export function CompareToggle({ enabled, onChange }: CompareToggleProps) {
  return (
    <button
      onClick={() => onChange(!enabled)}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-modal text-sm font-medium border transition-all ${
        enabled
          ? 'bg-indigo-500/15 text-indigo-300 border-indigo-500/25'
          : 'bg-secondary/40 text-foreground border-primary/10 hover:text-muted-foreground hover:bg-secondary/60'
      }`}
      title={enabled ? 'Comparing to previous period' : 'Compare to previous period'}
    >
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="flex-shrink-0">
        <path d="M1 10L4 6L7 8L13 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M1 12L4 9L7 10.5L13 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="2 2" opacity="0.5" />
      </svg>
      Compare
    </button>
  );
}

// ---------------------------------------------------------------------------
// PersonaSelect
// ---------------------------------------------------------------------------

interface PersonaSelectProps {
  value: string;
  onChange: (personaId: string) => void;
  personas: Persona[];
}

export function PersonaSelect({ value, onChange, personas }: PersonaSelectProps) {
  const { t } = useTranslation();
  return (
    <ThemedSelect
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="py-1.5"
    >
      <option value="">{t.overview.filters.all_personas}</option>
      {personas.map((p) => (
        <option key={p.id} value={p.id}>
          {p.icon ? `${p.icon} ` : ''}{p.name}
        </option>
      ))}
    </ThemedSelect>
  );
}
