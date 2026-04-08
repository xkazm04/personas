import { useState, useMemo } from 'react';
import { Search, Check, X, ChevronDown } from 'lucide-react';
import type { Persona } from '@/lib/bindings/Persona';
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
          <span className="text-sm text-foreground/85 truncate flex-1 text-left">
            {selected ? selected.name : showAll ? 'All Personas' : placeholder}
          </span>
          <ChevronDown className="w-3.5 h-3.5 text-muted-foreground/40 flex-shrink-0" />
        </button>
      )}

      {/* Modal */}
      <BaseModal
        isOpen={open}
        onClose={handleClose}
        titleId="persona-selector-modal"
        maxWidthClass="max-w-md"
        portal
        panelClassName="bg-background border border-primary/15 rounded-2xl shadow-elevation-4 flex flex-col overflow-hidden max-h-[70vh]"
      >
        {/* Header */}
        <div className="px-5 pt-5 pb-3 border-b border-primary/10 space-y-3">
          <div className="flex items-center justify-between">
            <h3 id="persona-selector-modal" className="text-sm font-semibold text-foreground/70 uppercase tracking-wider">Select Persona</h3>
            <button onClick={handleClose} className="p-1.5 rounded-lg hover:bg-secondary/50 text-muted-foreground/60 hover:text-foreground/80 transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-primary/10 bg-secondary/20">
            <Search className="w-3.5 h-3.5 text-muted-foreground/40" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search..."
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

        {/* Two-column compact list */}
        <div className="flex-1 overflow-y-auto p-3">
          <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
            {showAll && (
              <button
                type="button"
                onClick={() => handleSelect('')}
                className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg text-left transition-colors ${
                  !value
                    ? 'bg-primary/8 text-primary'
                    : 'text-foreground/70 hover:bg-secondary/40'
                }`}
              >
                <span className="text-sm truncate">All ({personas.length})</span>
                {!value && <Check className="w-3.5 h-3.5 flex-shrink-0" />}
              </button>
            )}

            {filtered.map((p) => {
              const isActive = value === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => handleSelect(p.id)}
                  className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg text-left transition-colors ${
                    isActive
                      ? 'bg-primary/8 text-primary'
                      : 'text-foreground/70 hover:bg-secondary/40'
                  }`}
                >
                  <span className="text-sm truncate">{p.name}</span>
                  {isActive && <Check className="w-3.5 h-3.5 flex-shrink-0" />}
                </button>
              );
            })}
          </div>

          {filtered.length === 0 && search && (
            <div className="py-6 text-center text-sm text-muted-foreground/40">No personas matching &ldquo;{search}&rdquo;</div>
          )}
        </div>
      </BaseModal>
    </>
  );
}
