import { createContext, useContext, useMemo, useState, useCallback, type ReactNode } from 'react';

export type OverviewDayRange = 1 | 7 | 30 | 90;

/** [startDate, endDate] as ISO YYYY-MM-DD strings. */
export type CustomDateRange = [string, string];

export interface OverviewFilterValues {
  selectedPersonaId: string;
  dayRange: OverviewDayRange;
  /** When set, overrides dayRange with an arbitrary date window. */
  customDateRange: CustomDateRange | null;
  /** Effective number of days for the active filter (preset or custom). */
  effectiveDays: number;
  /** ISO start date for the active filter (custom start or computed from dayRange). */
  effectiveStartDate: string;
  /** ISO end date for the active filter (custom end or today). */
  effectiveEndDate: string;
  /** ISO date string (YYYY-MM-DD) for drilling down from a failure spike to knowledge graph. */
  failureDrilldownDate: string | null;
  /** Whether to overlay the previous period as ghost lines on charts. */
  compareEnabled: boolean;
  /** Days to fetch for the previous period (= 2x effectiveDays to get both periods in one call). */
  previousPeriodDays: number;
}

export interface OverviewFilterActions {
  setSelectedPersonaId: (personaId: string) => void;
  setDayRange: (days: OverviewDayRange) => void;
  setCustomDateRange: (range: CustomDateRange | null) => void;
  setFailureDrilldownDate: (date: string | null) => void;
  setCompareEnabled: (enabled: boolean) => void;
}

/** @deprecated Use {@link OverviewFilterValues} & {@link OverviewFilterActions} separately. */
export type OverviewFilterContextValue = OverviewFilterValues & OverviewFilterActions;

const OverviewFilterValuesContext = createContext<OverviewFilterValues | null>(null);
const OverviewFilterActionsContext = createContext<OverviewFilterActions | null>(null);

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function OverviewFilterProvider({ children }: { children: ReactNode }) {
  const [selectedPersonaId, setSelectedPersonaId] = useState('');
  const [dayRange, setDayRangeRaw] = useState<OverviewDayRange>(30);
  const [customDateRange, setCustomDateRangeRaw] = useState<CustomDateRange | null>(null);
  const [failureDrilldownDate, setFailureDrilldownDateRaw] = useState<string | null>(null);
  const [compareEnabled, setCompareEnabledRaw] = useState(false);

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

  const setCompareEnabled = useCallback((enabled: boolean) => {
    setCompareEnabledRaw(enabled);
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

  const values = useMemo<OverviewFilterValues>(() => ({
    selectedPersonaId,
    dayRange,
    customDateRange,
    effectiveDays,
    effectiveStartDate,
    effectiveEndDate,
    failureDrilldownDate,
    compareEnabled,
    previousPeriodDays,
  }), [selectedPersonaId, dayRange, customDateRange, effectiveDays, effectiveStartDate, effectiveEndDate, failureDrilldownDate, compareEnabled, previousPeriodDays]);

  const actions = useMemo<OverviewFilterActions>(() => ({
    setSelectedPersonaId,
    setDayRange,
    setCustomDateRange,
    setFailureDrilldownDate,
    setCompareEnabled,
  }), [setDayRange, setCustomDateRange, setFailureDrilldownDate, setCompareEnabled]);

  return (
    <OverviewFilterActionsContext.Provider value={actions}>
      <OverviewFilterValuesContext.Provider value={values}>
        {children}
      </OverviewFilterValuesContext.Provider>
    </OverviewFilterActionsContext.Provider>
  );
}

/** Subscribe to volatile filter values only. Re-renders when any value changes. */
export function useOverviewFilterValues(): OverviewFilterValues {
  const ctx = useContext(OverviewFilterValuesContext);
  if (!ctx) {
    throw new Error('useOverviewFilterValues must be used within OverviewFilterProvider');
  }
  return ctx;
}

/** Subscribe to stable setter actions only. Never re-renders on value changes. */
export function useOverviewFilterActions(): OverviewFilterActions {
  const ctx = useContext(OverviewFilterActionsContext);
  if (!ctx) {
    throw new Error('useOverviewFilterActions must be used within OverviewFilterProvider');
  }
  return ctx;
}

/** Returns both values and actions. Prefer the split hooks when possible. */
export function useOverviewFilters(): OverviewFilterContextValue {
  const values = useOverviewFilterValues();
  const actions = useOverviewFilterActions();
  return useMemo(() => ({ ...values, ...actions }), [values, actions]);
}
