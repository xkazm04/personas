import type { Persona } from '@/lib/bindings/Persona';
import { ThemedSelect } from '@/features/shared/components/ThemedSelect';
import type { OverviewDayRange } from '@/features/overview/components/OverviewFilterContext';

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
}

export function DayRangePicker({ value, onChange }: DayRangePickerProps) {
  return (
    <div role="group" aria-label="Time range" className="flex items-center gap-1 p-1 bg-secondary/50 backdrop-blur-md rounded-xl border border-primary/20">
      {DAY_OPTIONS.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          aria-pressed={value === opt.value}
          className={`px-3 py-1 rounded-lg text-sm font-medium transition-all ${
            value === opt.value
              ? 'bg-background text-foreground shadow-sm border border-primary/20'
              : 'text-muted-foreground/80 hover:text-muted-foreground'
          } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-2 focus-visible:ring-offset-background`}
        >
          {opt.label}
        </button>
      ))}
    </div>
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
  return (
    <ThemedSelect
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="py-1.5"
    >
      <option value="">All Personas</option>
      {personas.map((p) => (
        <option key={p.id} value={p.id}>
          {p.icon ? `${p.icon} ` : ''}{p.name}
        </option>
      ))}
    </ThemedSelect>
  );
}
