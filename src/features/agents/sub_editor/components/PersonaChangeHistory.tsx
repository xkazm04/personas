import { useEffect, useState, useCallback } from 'react';
import { History, ArrowRight } from 'lucide-react';
import { listPersonaChangeLog } from '@/api/agents/personas';
import { silentCatch } from '@/lib/silentCatch';
import { storeBus } from '@/lib/storeBus';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { useTranslation } from '@/i18n/useTranslation';
import type { PersonaChangeEntry } from '@/lib/bindings/PersonaChangeEntry';

interface PersonaChangeHistoryProps {
  personaId: string;
}

const SOURCE_TONE: Record<string, string> = {
  editor: 'bg-primary/10 text-primary border-primary/20',
  header: 'bg-violet-500/10 text-violet-400 border-violet-500/20',
  fanout: 'bg-sky-500/10 text-sky-400 border-sky-500/20',
  other: 'bg-secondary/40 text-foreground border-primary/10',
};

/**
 * Editor Settings → recent change history. Field-level "who changed my agent's
 * model / budget / prompt, and when" trail. Read-only (no restore) — reads the
 * append-only persona_change_log via IPC and refreshes when a save lands.
 */
export function PersonaChangeHistory({ personaId }: PersonaChangeHistoryProps) {
  const { t } = useTranslation();
  const labels = t.agents.change_history;
  const [entries, setEntries] = useState<PersonaChangeEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    listPersonaChangeLog(personaId, 50)
      .then(setEntries)
      .catch((err) => { silentCatch('PersonaChangeHistory:list')(err); })
      .finally(() => setLoading(false));
  }, [personaId]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  // A completed run never edits config, but saves do — re-pull when the store
  // signals a persona changed so a fresh edit shows without a manual refresh.
  useEffect(() => {
    const off = storeBus.on('persona:selected', ({ personaId: pid }) => {
      if (pid === personaId) load();
    });
    return off;
  }, [personaId, load]);

  const fieldLabel = (field: string): string =>
    (labels.fields as Record<string, string>)[field] ?? field;

  const sourceLabel = (source: string | null): string => {
    const map = labels.sources as Record<string, string>;
    return (source ? map[source] : undefined) ?? map.other ?? 'other';
  };

  const displayValue = (v: string | null): string =>
    v == null || v === '' ? labels.empty_value : v;

  return (
    <div className="space-y-3">
      <h4 className="flex items-center gap-2.5 typo-submodule-header tracking-wide">
        <span className="w-6 h-[2px] bg-gradient-to-r from-primary to-accent rounded-full" />
        <History className="w-3.5 h-3.5" />
        {labels.title}
      </h4>
      <div className="bg-secondary/40 backdrop-blur-sm border border-primary/20 rounded-modal p-3">
        {loading ? (
          <div className="space-y-2 animate-pulse" aria-hidden="true">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-5 rounded-card bg-primary/5" />
            ))}
          </div>
        ) : entries.length === 0 ? (
          <p className="flex items-center justify-center gap-2 py-4 typo-body text-foreground/60">
            <History className="w-3.5 h-3.5" />
            {labels.empty}
          </p>
        ) : (
          <ul className="divide-y divide-primary/10">
            {entries.map((e) => (
              <li key={e.id} className="flex items-center gap-2 py-2 first:pt-0 last:pb-0">
                <span className="typo-body font-medium text-foreground min-w-0 shrink-0">
                  {fieldLabel(e.field)}
                </span>
                <span className="flex items-center gap-1.5 min-w-0 flex-1 typo-caption text-foreground/70">
                  <span className="truncate max-w-[8rem]" title={displayValue(e.beforeValue)}>
                    {displayValue(e.beforeValue)}
                  </span>
                  <ArrowRight className="w-3 h-3 shrink-0 opacity-60" />
                  <span className="truncate max-w-[8rem] text-foreground" title={displayValue(e.afterValue)}>
                    {displayValue(e.afterValue)}
                  </span>
                </span>
                <span className={`shrink-0 px-1.5 py-0.5 rounded-card border typo-caption ${SOURCE_TONE[e.source ?? 'other'] ?? SOURCE_TONE.other}`}>
                  {sourceLabel(e.source)}
                </span>
                <RelativeTime timestamp={e.createdAt} className="shrink-0 typo-caption text-foreground/60" />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
