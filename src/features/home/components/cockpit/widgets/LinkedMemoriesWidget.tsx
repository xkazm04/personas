import { useEffect, useState } from 'react';
import { Brain, Star } from 'lucide-react';

import { listMemoriesByExecution } from '@/api/overview/memories';
import { useTranslation } from '@/i18n/useTranslation';
import { silentCatch } from '@/lib/silentCatch';
import type { PersonaMemory } from '@/lib/bindings/PersonaMemory';

import type { CockpitWidgetProps } from '../widgetRegistry';

/**
 * Linked memories — persona memories stamped with `source_execution_id`
 * matching the contextual message's execution. Lets the user see what
 * the agent retained from this run alongside its message + decisions.
 *
 * Config:
 *   { executionId: string }
 */
export function LinkedMemoriesWidget({ config, title }: CockpitWidgetProps) {
  const { t } = useTranslation();
  const executionId = (config?.executionId as string | undefined) ?? '';

  const [memories, setMemories] = useState<PersonaMemory[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!executionId) {
      setMemories([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    listMemoriesByExecution(executionId)
      .then((rows) => { if (!cancelled) setMemories(rows); })
      .catch((err) => {
        silentCatch('LinkedMemoriesWidget:listMemoriesByExecution')(err);
        if (!cancelled) setMemories([]);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [executionId]);

  return (
    <div
      data-testid="cockpit-widget-linked_memories"
      className="rounded-card border border-foreground/10 bg-foreground/[0.02] p-4 h-full flex flex-col min-h-0"
    >
      <div className="flex items-center justify-between mb-3">
        <div className="typo-caption text-foreground/60 uppercase tracking-wide flex items-center gap-1.5">
          <Brain className="w-3 h-3 text-foreground/55" />
          {title ?? t.overview.cockpit.linked_memories_title}
        </div>
        {!loading && (
          <span className="typo-caption text-foreground/40">{memories.length}</span>
        )}
      </div>

      {loading ? (
        <div className="flex-1 grid grid-cols-1 gap-2 animate-pulse">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="rounded-input bg-foreground/[0.04] h-12" />
          ))}
        </div>
      ) : memories.length === 0 ? (
        <div className="flex-1 flex items-center justify-center typo-caption text-foreground/45 italic">
          {t.overview.cockpit.linked_memories_empty}
        </div>
      ) : (
        <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-2 overflow-y-auto min-h-0 auto-rows-min">
          {memories.map((m) => (
            <div
              key={m.id}
              className="rounded-input border border-foreground/10 bg-background/40 px-3 py-2 min-w-0"
            >
              <div className="flex items-center gap-2 mb-1">
                <CategoryBadge category={m.category} />
                <ImportancePip importance={m.importance} />
                <span className="ml-auto typo-caption text-foreground/35 uppercase tracking-wide">
                  {m.tier}
                </span>
              </div>
              <p className="typo-body font-medium text-foreground/90 truncate">{m.title}</p>
              <p className="typo-caption text-foreground/55 line-clamp-2">{m.content}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CategoryBadge({ category }: { category: string }) {
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded-input typo-caption text-foreground/75 bg-foreground/[0.06] border border-foreground/10 uppercase tracking-wide">
      {category}
    </span>
  );
}

function ImportancePip({ importance }: { importance: number }) {
  return (
    <span className="inline-flex items-center gap-0.5 typo-caption text-amber-300/85">
      <Star className="w-3 h-3 fill-amber-300/85" />
      {importance}
    </span>
  );
}
