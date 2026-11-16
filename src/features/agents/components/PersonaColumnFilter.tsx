import { useState } from 'react';
import { Filter, X } from 'lucide-react';
import { TABLE_HEAD_LABEL } from '@/features/shared/components/display/tableTokens';
import type { Persona } from '@/lib/bindings/Persona';
import { PersonaSelectorModal } from '@/features/agents/components/PersonaSelectorModal';
import { useTranslation } from '@/i18n/useTranslation';
import Button from '@/features/shared/components/buttons/Button';
import { PressSurface } from '@/features/shared/components/buttons';

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
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const selected = value ? personas.find((p) => p.id === value) : null;
  const isFiltered = !!selected;

  return (
    <span className="inline-flex items-center gap-1.5">
      <PressSurface
        onPress={() => setOpen(true)}
        selected={isFiltered}
        aria-pressed={undefined}
        className="rounded-input -mx-1 px-1"
      >
        <span className={`flex items-center gap-1.5 ${TABLE_HEAD_LABEL} ${isFiltered ? 'text-ink-1' : 'text-ink-2'}`}>
          <span>{selected ? selected.name : label}</span>
          {!selected && <Filter className="w-3 h-3 text-ink-3" />}
        </span>
      </PressSurface>
      {selected && (
        <Button
          type="button"
          onClick={(e) => { e.stopPropagation(); onChange(''); }}
          aria-label={t.common.clear}
          variant="ghost"
          size="icon-sm"
          icon={<X className="w-3 h-3" />}
        />
      )}

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
    </span>
  );
}
