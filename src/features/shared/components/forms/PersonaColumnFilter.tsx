import { useState } from 'react';
import { Users, X } from 'lucide-react';
import type { Persona } from '@/lib/bindings/Persona';
import { PersonaSelectorModal } from './PersonaSelectorModal';

interface PersonaColumnFilterProps {
  value: string;
  onChange: (personaId: string) => void;
  personas: Persona[];
}

/**
 * Thin wrapper for table column headers that shows a text label
 * matching standard header styling. Opens PersonaSelectorModal on click.
 * Does NOT embed the full trigger button — preserves table header consistency.
 */
export function PersonaColumnFilter({ value, onChange, personas }: PersonaColumnFilterProps) {
  const [open, setOpen] = useState(false);
  const selected = value ? personas.find((p) => p.id === value) : null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 text-sm font-medium text-foreground/80 hover:text-foreground transition-colors"
      >
        <Users className="w-3.5 h-3.5 text-muted-foreground/50" />
        {selected ? selected.name : 'Persona'}
        {selected && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onChange(''); }}
            className="ml-0.5 p-0.5 rounded hover:bg-secondary/50 text-muted-foreground/40 hover:text-muted-foreground/70"
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </button>

      {/* Render modal at root level */}
      {open && (
        <PersonaSelectorModal
          value={value}
          onChange={(id) => { onChange(id); setOpen(false); }}
          personas={personas}
          showAll
          defaultOpen
          onExternalClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
