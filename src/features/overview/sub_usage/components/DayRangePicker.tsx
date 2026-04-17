import { useState, useRef, useEffect, forwardRef } from 'react';
import { Calendar } from 'lucide-react';
import type { OverviewDayRange, CustomDateRange } from '@/features/overview/components/dashboard/OverviewFilterContext';
import { useTranslation } from '@/i18n/useTranslation';

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
  const { t } = useTranslation();
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
      ) { setShowCustom(false); }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showCustom]);

  const formatRangeLabel = (range: CustomDateRange): string => {
    const fmt = (iso: string) => {
      const d = new Date(iso + 'T00:00:00');
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    };
    return `${fmt(range[0])} -- ${fmt(range[1])}`;
  };

  return (
    <div className="relative">
      <div role="group" aria-label={t.overview.usage_filters.time_range_label} className="flex items-center gap-1 p-1 bg-secondary/50 backdrop-blur-md rounded-modal border border-primary/20">
        {DAY_OPTIONS.map((opt) => (
          <button key={opt.value} onClick={() => { onChange(opt.value); setShowCustom(false); }} aria-pressed={!isCustomActive && value === opt.value}
            className={`px-3 py-1 rounded-modal typo-body font-medium transition-all ${!isCustomActive && value === opt.value ? 'bg-background text-foreground shadow-elevation-1 border border-primary/20' : 'text-foreground hover:text-muted-foreground'} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-2 focus-visible:ring-offset-background`}
          >{opt.label}</button>
        ))}
        <button ref={buttonRef} onClick={() => setShowCustom((p) => !p)} aria-pressed={isCustomActive}
          className={`px-3 py-1 rounded-modal typo-body font-medium transition-all flex items-center gap-1.5 ${isCustomActive ? 'bg-background text-foreground shadow-elevation-1 border border-primary/20' : 'text-foreground hover:text-muted-foreground'} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-2 focus-visible:ring-offset-background`}
        >
          <Calendar className="w-3 h-3" />
          {isCustomActive ? formatRangeLabel(customDateRange) : 'Custom'}
        </button>
      </div>

      {showCustom && onCustomDateRangeChange && (
        <DateRangePopover ref={popoverRef} value={customDateRange ?? null} onChange={(range) => { onCustomDateRangeChange(range); if (range) setShowCustom(false); }} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// DateRangePopover
// ---------------------------------------------------------------------------

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
      if (startDate && endDate && startDate <= endDate) onChange([startDate, endDate]);
    };

    const isValid = startDate !== '' && endDate !== '' && startDate <= endDate;
    const dayCount = isValid ? Math.max(1, Math.ceil((new Date(endDate).getTime() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24))) : 0;

    return (
      <div ref={ref} className="absolute top-full right-0 mt-2 z-50 bg-background/95 backdrop-blur-md border border-primary/20 rounded-modal shadow-elevation-3 p-4 min-w-[280px]">
        <div className="space-y-3">
          <div>
            <label className="block typo-body text-foreground mb-1">Start Date</label>
            <input type="date" value={startDate} max={endDate || today} onChange={(e) => setStartDate(e.target.value)} className="w-full px-3 py-1.5 typo-body rounded-card bg-secondary/50 border border-primary/15 text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/50 focus-visible:border-blue-400/50" />
          </div>
          <div>
            <label className="block typo-body text-foreground mb-1">End Date</label>
            <input type="date" value={endDate} min={startDate} max={today} onChange={(e) => setEndDate(e.target.value)} className="w-full px-3 py-1.5 typo-body rounded-card bg-secondary/50 border border-primary/15 text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/50 focus-visible:border-blue-400/50" />
          </div>
          {isValid && <p className="typo-body text-foreground">{dayCount} day{dayCount !== 1 ? 's' : ''} selected</p>}
          <div className="flex items-center gap-2">
            <button onClick={handleApply} disabled={!isValid} title={!isValid ? 'Select a valid date range to apply' : undefined} className="flex-1 px-3 py-1.5 typo-body font-medium rounded-card bg-blue-500/15 text-blue-300 border border-blue-500/25 hover:bg-blue-500/25 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">{t.overview.day_range.apply}</button>
            {value && <button onClick={() => onChange(null)} className="px-3 py-1.5 typo-body font-medium rounded-card text-foreground hover:text-muted-foreground hover:bg-secondary/50 transition-colors">Clear</button>}
          </div>
        </div>
      </div>
    );
  },
);
