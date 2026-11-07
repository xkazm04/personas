import { useState, useMemo } from 'react';
import { Search, Check, X, ChevronDown } from 'lucide-react';
import type { Persona } from '@/lib/bindings/Persona';
import { BaseModal } from '@/lib/ui/BaseModal';
import { useTranslation } from '@/i18n/useTranslation';
import Button from '@/features/shared/components/buttons/Button';
import { OptionRow } from '@/features/shared/components/forms/OptionRow';

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
  placeholder: placeholderProp,
  showAll = true,
  defaultOpen = false,
  onExternalClose,
}: PersonaSelectorModalProps) {
  const { t } = useTranslation();
  const placeholder = placeholderProp ?? t.shared.persona_select;
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
        <Button
          type="button"
          onClick={() => setOpen(true)}
          variant="secondary"
          size="sm"
          className="min-w-[180px]"
        >
          <span className="typo-body text-ink-1 truncate flex-1 text-left">
          {selected ? selected.name : showAll ? t.shared.persona_all : placeholder}
          </span>
          <ChevronDown className="w-3.5 h-3.5 text-ink-1 flex-shrink-0" />
        </Button>
      )}

      {/* Modal */}
      <BaseModal
        isOpen={open}
        onClose={handleClose}
        titleId="persona-selector-modal"
        maxWidthClass="max-w-2xl"
        portal
        panelClassName="bg-background border border-hair rounded-card shadow-elevation-4 flex flex-col overflow-hidden max-h-[70vh]"
      >
        {/* Header */}
        <div className="px-5 pt-5 pb-3 border-b border-hair space-y-3">
          <div className="flex items-center justify-between">
            <h3 id="persona-selector-modal" className="typo-heading text-ink-1 uppercase">{t.shared.persona_modal_title}</h3>
            <Button
              type="button"
              onClick={handleClose}
              aria-label={t.common.close}
              variant="ghost"
              size="icon-sm"
              icon={<X className="w-4 h-4" />}
            />
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-card border border-hair bg-surface-1">
            <Search className="w-3.5 h-3.5 text-ink-1" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t.shared.search_ellipsis}
              className="flex-1 bg-transparent typo-body text-ink-1 placeholder:text-ink-3 outline-none"
              autoFocus
            />
            {search && (
              <Button
                type="button"
                onClick={() => setSearch('')}
                aria-label={t.common.clear}
                variant="ghost"
                size="icon-sm"
                icon={<X className="w-3.5 h-3.5" />}
              />
            )}
          </div>
        </div>

        {/* Two-column compact list */}
        <div className="flex-1 overflow-y-auto p-3">
          <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
            {showAll && (
              <OptionRow
                selected={!value}
                onSelect={() => handleSelect('')}
                meta={!value ? <Check className="w-3.5 h-3.5 text-primary" /> : undefined}
              >
                <span className="truncate block">{t.shared.forms_extra.all_prefix}{personas.length})</span>
              </OptionRow>
            )}

            {filtered.map((p) => {
              const isActive = value === p.id;
              return (
                <OptionRow
                  key={p.id}
                  selected={isActive}
                  onSelect={() => handleSelect(p.id)}
                  meta={isActive ? <Check className="w-3.5 h-3.5 text-primary" /> : undefined}
                >
                  <span className="truncate block">{p.name}</span>
                </OptionRow>
              );
            })}
          </div>

          {filtered.length === 0 && search && (
            <div className="py-6 text-center typo-body text-ink-1">{t.shared.persona_no_match.replace('{query}', search)}</div>
          )}
        </div>
      </BaseModal>
    </>
  );
}
