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
import { silentCatch } from '@/lib/silentCatch';
import { useAgentStore } from '@/stores/agentStore';
import type { Persona } from '@/lib/types/types';

interface ExecutePersonaPickerProps {
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  disabled?: boolean;
}

const GHOST_BAR = 'rounded bg-primary/[0.06]';

export function ExecutePersonaPicker({ selectedIds, onToggle, disabled }: ExecutePersonaPickerProps) {
  const { t } = useTranslation();
  const s = t.settings.api_keys;

  const storePersonas = useAgentStore((st) => st.personas);
  const [personas, setPersonas] = useState<Persona[]>(() => storePersonas);
  const [loading, setLoading] = useState(() => storePersonas.length === 0);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    let alive = true;
    listPersonas()
      .then((rows) => {
        if (alive) setPersonas(rows);
      })
      .catch(silentCatch('ExecutePersonaPicker:listPersonas'))
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return personas;
    return personas.filter((p) => p.name.toLowerCase().includes(q));
  }, [personas, filter]);

  const showGhost = loading && personas.length === 0;

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
      {showGhost ? (
        <PersonaPickerGhostRows />
      ) : personas.length === 0 ? (
        <p className="typo-caption text-foreground py-3 text-center bg-secondary/20 rounded-input">
          {s.execute_no_personas}
        </p>
      ) : (
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
      )}
    </div>
  );
}

function PersonaPickerGhostRows() {
  return (
    <div className="max-h-40 space-y-1 pr-1" aria-hidden="true">
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className="flex items-center gap-2 px-2.5 py-1.5 rounded-input border border-border/30 animate-fade-in"
          style={{ animationDelay: `${120 + i * 35}ms` }}
        >
          <span className={`h-3.5 w-3.5 flex-shrink-0 ${GHOST_BAR}`} />
          <span className={`h-3 w-32 ${GHOST_BAR}`} />
        </div>
      ))}
    </div>
  );
}
