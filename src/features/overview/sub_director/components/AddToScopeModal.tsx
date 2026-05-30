import { useMemo, useState } from 'react';
import { Search, Plus, Check } from 'lucide-react';
import { BaseModal } from '@/lib/ui/BaseModal';
import { PersonaIcon } from '@/features/shared/components/display/PersonaIcon';
import { useTranslation } from '@/i18n/useTranslation';
import type { Persona } from '@/lib/bindings/Persona';

/**
 * Add-to-scope picker — a searchable list of non-system personas not yet in the
 * Director's scope. Clicking one stars it (puts it in scope). Lives in a modal
 * so the coaching tab stays compact. Stays open for multi-add; closes on demand.
 */
export function AddToScopeModal({
  open,
  onClose,
  personas,
  onAdd,
}: {
  open: boolean;
  onClose: () => void;
  /** All personas; the modal filters to non-system + unstarred. */
  personas: Persona[];
  onAdd: (personaId: string) => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [justAdded, setJustAdded] = useState<Set<string>>(new Set());

  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase();
    return personas
      .filter((p) => !p.starred && p.trust_origin !== 'system')
      .filter((p) => !q || p.name.toLowerCase().includes(q));
  }, [personas, query]);

  const add = (id: string) => {
    onAdd(id);
    setJustAdded((s) => new Set(s).add(id));
  };

  return (
    <BaseModal
      isOpen={open}
      onClose={onClose}
      titleId="director-add-scope-title"
      size="md"
      portal
      staggerChildren={false}
      panelClassName="relative bg-gradient-to-b from-background to-[color-mix(in_srgb,var(--color-background),var(--color-primary)_3%)] border border-primary/15 rounded-2xl shadow-elevation-4 overflow-hidden flex flex-col w-full max-h-[70vh]"
    >
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-primary/10 bg-secondary/20">
        <h3 id="director-add-scope-title" className="typo-body-lg font-semibold text-foreground">
          {t.director.roster_add_title}
        </h3>
      </div>

      <div className="px-5 pt-3.5 pb-2">
        <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-input border border-primary/15 bg-secondary/30 focus-within:border-primary/35 transition-colors">
          <Search className="w-3.5 h-3.5 text-foreground shrink-0" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t.director.add_search_placeholder}
            className="flex-1 bg-transparent outline-none typo-body text-foreground placeholder:text-foreground"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 pb-4 min-h-0">
        {candidates.length === 0 ? (
          <p className="typo-body text-foreground text-center py-8">{t.director.roster_add_placeholder}</p>
        ) : (
          <ul className="space-y-0.5">
            {candidates.map((p) => {
              const added = justAdded.has(p.id);
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    disabled={added}
                    onClick={() => add(p.id)}
                    className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-card hover:bg-secondary/40 transition-colors text-left disabled:opacity-60"
                  >
                    <PersonaIcon icon={p.icon} color={p.color} size="w-4 h-4" />
                    <span className="typo-body text-foreground truncate flex-1">{p.name}</span>
                    {added ? (
                      <span className="inline-flex items-center gap-1 typo-caption text-[var(--status-success)]">
                        <Check className="w-3.5 h-3.5" />
                      </span>
                    ) : (
                      <Plus className="w-4 h-4 text-violet-300" />
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </BaseModal>
  );
}
