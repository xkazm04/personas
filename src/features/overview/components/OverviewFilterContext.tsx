import { createContext, useContext, useMemo, useState, useCallback, type ReactNode } from 'react';

export type OverviewDayRange = 1 | 7 | 30 | 90;

interface OverviewFilterContextValue {
  selectedPersonaId: string;
  setSelectedPersonaId: (personaId: string) => void;
  dayRange: OverviewDayRange;
  setDayRange: (days: OverviewDayRange) => void;
  /** ISO date string (YYYY-MM-DD) for drilling down from a failure spike to knowledge graph. */
  failureDrilldownDate: string | null;
  setFailureDrilldownDate: (date: string | null) => void;
}

const OverviewFilterContext = createContext<OverviewFilterContextValue | null>(null);

export function OverviewFilterProvider({ children }: { children: ReactNode }) {
  const [selectedPersonaId, setSelectedPersonaId] = useState('');
  const [dayRange, setDayRange] = useState<OverviewDayRange>(30);
  const [failureDrilldownDate, setFailureDrilldownDateRaw] = useState<string | null>(null);

  const setFailureDrilldownDate = useCallback((date: string | null) => {
    setFailureDrilldownDateRaw(date);
  }, []);

  const value = useMemo<OverviewFilterContextValue>(() => ({
    selectedPersonaId,
    setSelectedPersonaId,
    dayRange,
    setDayRange,
    failureDrilldownDate,
    setFailureDrilldownDate,
  }), [selectedPersonaId, dayRange, failureDrilldownDate, setFailureDrilldownDate]);

  return <OverviewFilterContext.Provider value={value}>{children}</OverviewFilterContext.Provider>;
}

export function useOverviewFilters(): OverviewFilterContextValue {
  const ctx = useContext(OverviewFilterContext);
  if (!ctx) {
    throw new Error('useOverviewFilters must be used within OverviewFilterProvider');
  }
  return ctx;
}
