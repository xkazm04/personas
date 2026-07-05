/**
 * Per-agent execute-scope picker for the create-API-key dialog.
 *
 * The capability-token model forces explicit per-persona grants — a key that
 * can execute must name each agent. This lists the user's personas (filterable)
 * and reports the selected ids up; the dialog turns each into a
 * `personas:execute:persona:<id>` scope.
 */
import { useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { listPersonas } from '@/api/agents/personas';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import type { Persona } from '@/lib/types/types';

interface ExecutePersonaPickerProps {
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  disabled?: boolean;
}

export function ExecutePersonaPicker({ selectedIds, onToggle, disabled }: ExecutePersonaPickerProps) {
  const { t } = useTranslation();
  const s = t.settings.api_keys;

  const [personas, setPersonas] = useState<Persona[] | null>(null);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    let alive = true;
    listPersonas()
      .then((rows) => {
        if (alive) setPersonas(rows);
      })
      .catch(() => {
        if (alive) setPersonas([]);
      });
    return () => {
      alive = false;
    };
  }, []);

  const filtered = useMemo(() => {
    if (!personas) return [];
    const q = filter.trim().toLowerCase();
    if (!q) return personas;
    return personas.filter((p) => p.name.toLowerCase().includes(q));
  }, [personas, filter]);

  if (personas === null) {
    return (
      <div className="flex items-center justify-center py-4">
        <LoadingSpinner size="sm" />
      </div>
    );
  }

  if (personas.length === 0) {
    return (
      <p className="typo-caption text-foreground py-3 text-center bg-secondary/20 rounded-input">
        {s.execute_no_personas}
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-foreground" />
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={s.execute_filter_placeholder}
          disabled={disabled}
          className="w-full pl-8 pr-3 py-1.5 bg-background border border-border/40 rounded-input typo-caption text-foreground focus:border-primary/60 focus:outline-none disabled:opacity-50"
        />
      </div>
      <div className="max-h-40 overflow-y-auto space-y-1 pr-1">
        {filtered.map((p) => {
          const isSelected = selectedIds.has(p.id);
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => onToggle(p.id)}
              disabled={disabled}
              className={`w-full text-left flex items-center gap-2 px-2.5 py-1.5 rounded-input border transition-colors disabled:opacity-50 ${
                isSelected
                  ? 'border-primary/40 bg-primary/10'
                  : 'border-border/30 bg-secondary/20 hover:bg-secondary/40'
              }`}
            >
              <input type="checkbox" checked={isSelected} readOnly tabIndex={-1} />
              <span className="typo-caption text-foreground truncate">{p.name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
