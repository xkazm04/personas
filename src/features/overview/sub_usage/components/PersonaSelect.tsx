import type { Persona } from '@/lib/bindings/Persona';
import { PersonaSelectorModal } from '@/features/shared/components/forms/PersonaSelectorModal';

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
  return (
    <PersonaSelectorModal
      value={value}
      onChange={onChange}
      personas={personas}
      showAll
    />
  );
}
