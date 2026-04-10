import { useState } from 'react';
import { Filter, X } from 'lucide-react';
import type { Persona } from '@/lib/bindings/Persona';
import { PersonaSelectorModal } from './PersonaSelectorModal';

interface PersonaColumnFilterProps {
  value: string;
  onChange: (personaId: string) => void;
  personas: Persona[];
  /** Label shown when no filter is active (default: "Persona") */
  label?: string;
}

/**
 * Thin wrapper for table column headers that shows a text label
 * matching standard header styling. Opens PersonaSelectorModal on click.
 * Shows a Filter icon on the right when unfiltered, label + X when filtered.
 */
export function PersonaColumnFilter({ value, onChange, personas, label = 'Persona' }: PersonaColumnFilterProps) {
  const [open, setOpen] = useState(false);
  const selected = value ? personas.find((p) => p.id === value) : null;
  const isFiltered = !!selected;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`flex items-center gap-1.5 typo-label transition-colors ${isFiltered ? 'text-primary' : 'text-foreground/80 hover:text-foreground'}`}
      >
        <span>{selected ? selected.name : label}</span>
        {selected ? (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onChange(''); }}
            className="p-0.5 rounded hover:bg-secondary/50 text-foreground hover:text-foreground"
          >
            <X className="w-3 h-3" />
          </button>
        ) : (
          <Filter className="w-3 h-3 text-foreground" />
        )}
      </button>

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
