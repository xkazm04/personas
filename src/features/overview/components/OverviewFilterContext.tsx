import { createContext, useContext, useMemo, useState, useCallback, type ReactNode } from 'react';

export type OverviewDayRange = 1 | 7 | 30 | 90;

/** [startDate, endDate] as ISO YYYY-MM-DD strings. */
export type CustomDateRange = [string, string];

interface OverviewFilterContextValue {
  selectedPersonaId: string;
  setSelectedPersonaId: (personaId: string) => void;
  dayRange: OverviewDayRange;
  setDayRange: (days: OverviewDayRange) => void;
  /** When set, overrides dayRange with an arbitrary date window. */
  customDateRange: CustomDateRange | null;
  setCustomDateRange: (range: CustomDateRange | null) => void;
  /** Effective number of days for the active filter (preset or custom). */
  effectiveDays: number;
  /** ISO start date for the active filter (custom start or computed from dayRange). */
  effectiveStartDate: string;
  /** ISO end date for the active filter (custom end or today). */
  effectiveEndDate: string;
  /** ISO date string (YYYY-MM-DD) for drilling down from a failure spike to knowledge graph. */
  failureDrilldownDate: string | null;
  setFailureDrilldownDate: (date: string | null) => void;
  /** Whether to overlay the previous period as ghost lines on charts. */
  compareEnabled: boolean;
  setCompareEnabled: (enabled: boolean) => void;
  /** Days to fetch for the previous period (= 2x effectiveDays to get both periods in one call). */
  previousPeriodDays: number;
}

const OverviewFilterContext = createContext<OverviewFilterContextValue | null>(null);

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function OverviewFilterProvider({ children }: { children: ReactNode }) {
  const [selectedPersonaId, setSelectedPersonaId] = useState('');
  const [dayRange, setDayRangeRaw] = useState<OverviewDayRange>(30);
  const [customDateRange, setCustomDateRangeRaw] = useState<CustomDateRange | null>(null);
  const [failureDrilldownDate, setFailureDrilldownDateRaw] = useState<string | null>(null);
  const [compareEnabled, setCompareEnabled] = useState(false);

  const setDayRange = useCallback((days: OverviewDayRange) => {
    setDayRangeRaw(days);
    setCustomDateRangeRaw(null);
  }, []);

  const setCustomDateRange = useCallback((range: CustomDateRange | null) => {
    setCustomDateRangeRaw(range);
  }, []);

  const setFailureDrilldownDate = useCallback((date: string | null) => {
    setFailureDrilldownDateRaw(date);
  }, []);

  const { effectiveDays, effectiveStartDate, effectiveEndDate } = useMemo(() => {
    if (customDateRange) {
      const [start, end] = customDateRange;
      const ms = new Date(end).getTime() - new Date(start).getTime();
      const days = Math.max(1, Math.ceil(ms / (1000 * 60 * 60 * 24)));
      return { effectiveDays: days, effectiveStartDate: start, effectiveEndDate: end };
    }
    const now = new Date();
    const endDate = toISODate(now);
    const startDate = toISODate(new Date(now.getTime() - dayRange * 24 * 60 * 60 * 1000));
    return { effectiveDays: dayRange, effectiveStartDate: startDate, effectiveEndDate: endDate };
  }, [customDateRange, dayRange]);

  const previousPeriodDays = effectiveDays * 2;

  const value = useMemo<OverviewFilterContextValue>(() => ({
    selectedPersonaId,
    setSelectedPersonaId,
    dayRange,
    setDayRange,
    customDateRange,
    setCustomDateRange,
    effectiveDays,
    effectiveStartDate,
    effectiveEndDate,
    failureDrilldownDate,
    setFailureDrilldownDate,
    compareEnabled,
    setCompareEnabled,
    previousPeriodDays,
  }), [selectedPersonaId, dayRange, customDateRange, effectiveDays, effectiveStartDate, effectiveEndDate, failureDrilldownDate, setDayRange, setCustomDateRange, setFailureDrilldownDate, compareEnabled, previousPeriodDays]);

  return <OverviewFilterContext.Provider value={value}>{children}</OverviewFilterContext.Provider>;
}

export function useOverviewFilters(): OverviewFilterContextValue {
  const ctx = useContext(OverviewFilterContext);
  if (!ctx) {
    throw new Error('useOverviewFilters must be used within OverviewFilterProvider');
  }
  return ctx;
}
