import { DayRangePicker } from '@/features/overview/sub_usage/components/DayRangePicker';
import { PersonaSelect, CompareToggle } from '@/features/overview/sub_usage/components/PersonaSelect';
import { SavedViewsDropdown } from './SavedViewsDropdown';
import type { Persona } from '@/lib/types/types';

interface AnalyticsFiltersProps {
  selectedPersonaId: string | null;
  setSelectedPersonaId: (id: string) => void;
  days: number;
  setDays: (days: 1 | 7 | 30 | 90) => void;
  customDateRange: [string, string] | null;
  setCustomDateRange: (range: [string, string] | null) => void;
  compareEnabled: boolean;
  setCompareEnabled: (v: boolean) => void;
  personas: Persona[];
}

export function AnalyticsFilters({
  selectedPersonaId, setSelectedPersonaId,
  days, setDays,
  customDateRange, setCustomDateRange,
  compareEnabled, setCompareEnabled,
  personas,
}: AnalyticsFiltersProps) {
  const handleApplyPreset = (
    personaId: string | null,
    dayRange: number,
    customRange: [string, string] | null,
    compare: boolean
  ) => {
    setSelectedPersonaId(personaId || '');
    setDays(dayRange as 1 | 7 | 30 | 90);
    setCustomDateRange(customRange);
    setCompareEnabled(compare);
  };

  return (
    <div className="px-4 md:px-6 xl:px-8 py-3 border-b border-primary/10 flex items-center justify-between gap-4 flex-wrap flex-shrink-0">
      <div className="flex items-center gap-4 flex-wrap">
        <PersonaSelect value={selectedPersonaId ?? ''} onChange={setSelectedPersonaId} personas={personas} />
        <DayRangePicker value={days as 1 | 7 | 30 | 90} onChange={setDays} customDateRange={customDateRange} onCustomDateRangeChange={setCustomDateRange} />
        <CompareToggle enabled={compareEnabled} onChange={setCompareEnabled} />
      </div>
      <div className="flex items-center gap-2">
        <SavedViewsDropdown
          currentPersonaId={selectedPersonaId}
          currentDayRange={days}
          currentCustomDateRange={customDateRange}
          currentCompareEnabled={compareEnabled}
          onApplyPreset={handleApplyPreset}
        />
      </div>
    </div>
  );
}
