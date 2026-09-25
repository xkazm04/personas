// The L2 project switcher (R21, migrated from the cockpit bench). It was the
// breadcrumb's leaf; since Gate 5 the trail lives in FactoryHead and this is
// its sibling switcher: a KitButton that opens the shared Listbox of every
// project, each with its attention Dot and a short note (off-track count or
// healthy). The hand-built portal menu with rgba inline colours is gone.
import { ChevronsUpDown } from 'lucide-react';

import { Button } from '@/features/shared/components/buttons';
import { Listbox } from '@/features/shared/components/forms/Listbox';
import { Dot, KitButton, type Tone } from '@/features/shared/components/kit';

export interface FactoryCrumbSibling {
  id: string;
  label: string;
  /** Short right-aligned note (off-track count, "healthy"...). */
  note?: string;
  tone: Tone;
}

export function FactoryProjectSwitcher({ current, siblings, label, onSelect }: {
  current: string;
  siblings: FactoryCrumbSibling[];
  label: string;
  onSelect: (id: string) => void;
}) {
  const pick = (i: number) => {
    const s = siblings[i];
    if (s && s.id !== current) onSelect(s.id);
  };
  return (
    <Listbox
      ariaLabel={label}
      itemCount={siblings.length}
      onSelectFocused={pick}
      menuClassName="animate-fade-slide-in absolute top-full mt-1 right-0 w-[280px] glass-sm rounded-card shadow-elevation-3 z-50 overflow-hidden py-1"
      renderTrigger={({ toggle, isOpen }) => (
        <KitButton onClick={toggle} expanded={isOpen} testId="factory-crumb-leaf">
          <span className="inline-flex items-center gap-2">
            {label}
            <ChevronsUpDown className="w-3.5 h-3.5" aria-hidden />
          </span>
        </KitButton>
      )}
    >
      {({ close, focusIndex }) => (
        <div data-testid="factory-crumb-switcher">
          {siblings.map((s, i) => (
            <Button
              key={s.id}
              variant="ghost"
              size="sm"
              role="option"
              aria-selected={s.id === current}
              className={`w-full justify-start gap-2 ${i === focusIndex || s.id === current ? 'bg-secondary/40' : ''}`}
              onClick={() => { close(); pick(i); }}
            >
              <span className="flex w-full items-center gap-2">
                <Dot tone={s.tone} glyph="solid" />
                <span className="typo-body truncate">{s.label}</span>
                {s.note && <span className="typo-caption ml-auto shrink-0">{s.note}</span>}
              </span>
            </Button>
          ))}
        </div>
      )}
    </Listbox>
  );
}
