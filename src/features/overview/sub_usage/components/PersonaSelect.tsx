import type { Persona } from '@/lib/bindings/Persona';
import Button from '@/features/shared/components/buttons/Button';
import { PersonaSelectorModal } from '@/features/agents/components/PersonaSelectorModal';

// ---------------------------------------------------------------------------
// CompareToggle
// ---------------------------------------------------------------------------

interface CompareToggleProps {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
}

export function CompareToggle({ enabled, onChange }: CompareToggleProps) {
  return (
    <Button variant="secondary" size="sm" onClick={() => onChange(!enabled)} tooltip={enabled ? 'Comparing to previous period' : 'Compare to previous period'}>
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="flex-shrink-0">
        <path d="M1 10L4 6L7 8L13 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M1 12L4 9L7 10.5L13 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="2 2" opacity="0.5" />
      </svg>
      Compare
    </Button>
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
