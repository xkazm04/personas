import { useEffect, useState } from 'react';

import { listMemoriesByExecution } from '@/api/overview/memories';
import { useTranslation } from '@/i18n/useTranslation';
import { tokenLabel } from '@/i18n/tokenMaps';
import { silentCatch } from '@/lib/silentCatch';
import { Hint, ListRow, Meta, Rows, Tile, UnitStrip, type Glyph, type Tone } from '@/features/shared/components/kit';
import type { PersonaMemory } from '@/lib/bindings/PersonaMemory';

import type { CockpitWidgetProps } from '../widgetRegistry';

/** Rows shown before "Show all" (home-2 contract). */
const CAP = 6;
/** PersonaMemory.importance is 1-5 (MEMORY CONTRACT (4)). */
const IMPORTANCE_MAX = 5;

/** A memory's tier on the row's Mark: pinned core solid, the scored hot set soft, the rest hollow. */
const TIER_MARK: Record<string, { tone: Tone; glyph: Glyph }> = {
  core: { tone: 'primary', glyph: 'solid' },
  active: { tone: 'primary', glyph: 'soft' },
  working: { tone: 'neutral', glyph: 'soft' },
  archive: { tone: 'neutral', glyph: 'hollow' },
};

/**
 * Linked memories - persona memories stamped with `source_execution_id`
 * matching the contextual message's execution. Lets the user see what
 * the agent retained from this run alongside its message + decisions.
 *
 * One kit Tile of rows with ONE emphasis each, the memory's title: its tier is
 * the row's Mark, its category leads the quiet meta line, its importance is
 * drawn as five units in the trail.
 *
 * Config:
 *   { executionId: string }
 */
export function LinkedMemoriesWidget({ config, title, span, actions, footer }: CockpitWidgetProps) {
  const { t, tx } = useTranslation();
  const c = t.overview.cockpit;
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

  const heading = title ?? c.linked_memories_title;
  return (
    <Tile
      span={span}
      title={heading}
      count={loading ? undefined : memories.length}
      actions={actions}
      footer={footer}
      testId="cockpit-widget-linked_memories"
      state={loading ? 'loading' : undefined}
    >
      <Rows count={memories.length} cap={CAP} label={heading} empty={{ title: c.linked_memories_empty }}>
        {memories.map((m) => {
          const tier = TIER_MARK[m.tier] ?? TIER_MARK.working!;
          const importance = Math.min(IMPORTANCE_MAX, Math.max(0, Math.round(m.importance)));
          const said = tx(c.linked_memories_importance, { value: importance, max: IMPORTANCE_MAX });
          return (
            <ListRow
              key={m.id}
              size="s"
              name={m.title}
              mark={{ ...tier, label: tokenLabel(t, 'memory_tier', m.tier) }}
              meta={<Meta parts={[tokenLabel(t, 'memory_category', m.category), <Hint key="c" content={m.content}><span className="k-ellipsis">{m.content}</span></Hint>]} />}
              figures={(
                <UnitStrip
                  size="s"
                  label={said}
                  segments={[{ n: importance, tone: 'primary' }, { n: IMPORTANCE_MAX - importance, tone: 'neutral', glyph: 'empty' }]}
                />
              )}
            />
          );
        })}
      </Rows>
    </Tile>
  );
}
