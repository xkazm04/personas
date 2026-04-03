import { useState, useMemo } from 'react';
import { Search, Check, Bot, X, ChevronDown } from 'lucide-react';
import type { Persona } from '@/lib/bindings/Persona';
import { PersonaIcon } from '@/features/shared/components/display/PersonaIcon';
import { BaseModal } from '@/lib/ui/BaseModal';

interface PersonaSelectorModalProps {
  value: string;
  onChange: (personaId: string) => void;
  personas: Persona[];
  placeholder?: string;
  showAll?: boolean;
  /** When true, modal opens immediately without rendering a trigger button. */
  defaultOpen?: boolean;
  /** Called when modal closes externally (used with defaultOpen). */
  onExternalClose?: () => void;
}

/**
 * Full-scale persona selector that opens a modal with cards grid,
 * search input, and persona icons sorted by name ascending.
 */
export function PersonaSelectorModal({
  value,
  onChange,
  personas,
  placeholder = 'Select persona',
  showAll = true,
  defaultOpen = false,
  onExternalClose,
}: PersonaSelectorModalProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [search, setSearch] = useState('');

  const sorted = useMemo(
    () => [...personas].sort((a, b) => a.name.localeCompare(b.name)),
    [personas],
  );

  const filtered = useMemo(() => {
    if (!search) return sorted;
    const q = search.toLowerCase();
    return sorted.filter((p) => p.name.toLowerCase().includes(q));
  }, [sorted, search]);

  const selected = value ? personas.find((p) => p.id === value) : null;

  const handleClose = () => {
    setOpen(false);
    setSearch('');
    onExternalClose?.();
  };

  const handleSelect = (id: string) => {
    onChange(id);
    handleClose();
  };

  return (
    <>
      {/* Trigger button — hidden when defaultOpen (externally controlled) */}
      {!defaultOpen && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex items-center gap-2 px-3 py-2 rounded-xl border border-primary/15 bg-secondary/20 hover:border-primary/25 hover:bg-secondary/30 transition-all min-w-[180px]"
        >
          {selected ? (
            <>
              <PersonaIcon icon={selected.icon} color={selected.color} frameSize="lg" />
              <span className="text-sm font-medium text-foreground/85 truncate flex-1 text-left">{selected.name}</span>
            </>
          ) : (
            <>
              <Bot className="w-3.5 h-3.5 text-muted-foreground/40 flex-shrink-0" />
              <span className="text-sm text-muted-foreground/50 flex-1 text-left">{showAll ? 'All Personas' : placeholder}</span>
            </>
          )}
          <ChevronDown className="w-3.5 h-3.5 text-muted-foreground/40 flex-shrink-0" />
        </button>
      )}

      {/* Modal */}
      <BaseModal
        isOpen={open}
        onClose={handleClose}
        titleId="persona-selector-modal"
        maxWidthClass="max-w-3xl"
        panelClassName="bg-background border border-primary/15 rounded-2xl shadow-elevation-4 flex flex-col overflow-hidden max-h-[80vh]"
      >
        {/* Header */}
        <div className="px-5 pt-5 pb-3 border-b border-primary/10 space-y-3">
          <div className="flex items-center justify-between">
            <h3 id="persona-selector-modal" className="text-lg font-semibold text-foreground">Select Persona</h3>
            <button onClick={handleClose} className="p-1.5 rounded-lg hover:bg-secondary/50 text-muted-foreground/60 hover:text-foreground/80 transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl border border-primary/10 bg-secondary/20">
            <Search className="w-4 h-4 text-muted-foreground/40" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search personas..."
              className="flex-1 bg-transparent text-sm text-foreground/80 placeholder:text-muted-foreground/30 outline-none"
              autoFocus
            />
            {search && (
              <button type="button" onClick={() => setSearch('')} className="text-muted-foreground/30 hover:text-muted-foreground/60">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Cards grid */}
        <div className="flex-1 overflow-y-auto p-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5">
            {/* All Personas option */}
            {showAll && (
              <button
                type="button"
                onClick={() => handleSelect('')}
                className={`flex items-center gap-3 p-3 rounded-xl border transition-all text-left ${
                  !value
                    ? 'border-primary/30 bg-primary/5 ring-1 ring-primary/20'
                    : 'border-primary/10 hover:border-primary/20 hover:bg-secondary/30'
                }`}
              >
                <div className="w-9 h-9 rounded-xl bg-secondary/40 border border-primary/10 flex items-center justify-center flex-shrink-0">
                  <Bot className="w-4 h-4 text-muted-foreground/50" />
                </div>
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium text-foreground/80 block">All Personas</span>
                  <span className="text-sm text-muted-foreground/40 block">{personas.length} total</span>
                </div>
                {!value && <Check className="w-4 h-4 text-primary flex-shrink-0" />}
              </button>
            )}

            {/* Persona cards */}
            {filtered.map((p) => {
              const isActive = value === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => handleSelect(p.id)}
                  className={`flex items-center gap-3 p-3 rounded-xl border transition-all text-left ${
                    isActive
                      ? 'border-primary/30 bg-primary/5 ring-1 ring-primary/20'
                      : 'border-primary/10 hover:border-primary/20 hover:bg-secondary/30'
                  }`}
                >
                  <PersonaIcon icon={p.icon} color={p.color} display="framed" frameSize="lg" />
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-medium text-foreground/85 block truncate">{p.name}</span>
                    {p.description && (
                      <span className="text-sm text-muted-foreground/40 block truncate">{p.description.slice(0, 50)}</span>
                    )}
                  </div>
                  {isActive && <Check className="w-4 h-4 text-primary flex-shrink-0" />}
                </button>
              );
            })}
          </div>

          {filtered.length === 0 && search && (
            <div className="py-8 text-center text-sm text-muted-foreground/40">No personas matching &ldquo;{search}&rdquo;</div>
          )}
        </div>
      </BaseModal>
    </>
  );
}
