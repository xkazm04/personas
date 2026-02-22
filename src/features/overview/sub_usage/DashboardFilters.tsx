import type { Persona } from '@/lib/bindings/Persona';

// ---------------------------------------------------------------------------
// DayRangePicker
// ---------------------------------------------------------------------------

export type DayRange = 7 | 30 | 90;

const DAY_OPTIONS: Array<{ value: DayRange; label: string }> = [
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
    <div className="flex items-center gap-1 p-1 bg-secondary/50 backdrop-blur-md rounded-xl border border-primary/20">
      {DAY_OPTIONS.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={`px-3 py-1 rounded-lg text-sm font-medium transition-all ${
            value === opt.value
              ? 'bg-background text-foreground shadow-sm border border-primary/20'
              : 'text-muted-foreground/80 hover:text-muted-foreground'
          }`}
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
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="bg-secondary/50 border border-primary/20 rounded-lg px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40 appearance-none cursor-pointer"
    >
      <option value="">All Personas</option>
      {personas.map((p) => (
        <option key={p.id} value={p.id}>
          {p.icon ? `${p.icon} ` : ''}{p.name}
        </option>
      ))}
    </select>
  );
}
