import { useCallback, useEffect, useMemo, useState } from 'react';

import { listMemoriesByExecution } from '@/api/overview/memories';
import { useTranslation } from '@/i18n/useTranslation';
import { tokenLabel } from '@/i18n/tokenMaps';
import { resolveErrorTranslated } from '@/i18n/useTranslatedError';
import { extractMessage, silentCatch } from '@/lib/silentCatch';
import { KitButton, Tile, UnitStrip, type Tone } from '@/features/shared/components/kit';
import type { PersonaMemory } from '@/lib/bindings/PersonaMemory';

import type { CockpitWidgetProps } from '../widgetRegistry';
import { Cell, WidgetTable, nameCell, type TableColumn } from './widgetTable';

/** Rows shown before "Show all" (home-2 contract). */
const CAP = 6;
/** PersonaMemory.importance is 1-5 (MEMORY CONTRACT (4)). */
const IMPORTANCE_MAX = 5;

/** A memory's tier as the row's accent: pinned core and the scored hot set read primary, the rest quiet. */
const TIER_TONE: Record<string, Tone> = {
  core: 'primary',
  active: 'primary',
  working: 'neutral',
  archive: 'neutral',
};

/**
 * Linked memories - persona memories stamped with `source_execution_id`
 * matching the contextual message's execution. Lets the user see what
 * the agent retained from this run alongside its message + decisions.
 *
 * One kit Tile holding ONE `UnifiedTable` — the app's shared table (see `widgetTable.tsx`) — with
 * ONE emphasis per row, the memory's title. Its tier is the row's left accent, its category and
 * its content are named columns rather than running together on a meta line under the title, and
 * its importance is five drawn units in the last column (a figure, which doctrine 6c leaves to
 * the kit's `UnitStrip`).
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
  // A thrown list call used to become `[]`, which rendered "No memories recorded for this
  // execution" - a claim about the run the widget never got to read. Its sibling
  // LinkedDecisionsWidget already splits the two; this keeps the rejection value for the resolver.
  const [error, setError] = useState<{ raw: unknown } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    if (!executionId) {
      setMemories([]);
      setError(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setError(null);
    setLoading(true);
    listMemoriesByExecution(executionId)
      .then((rows) => { if (!cancelled) setMemories(rows); })
      .catch((err) => {
        silentCatch('LinkedMemoriesWidget:listMemoriesByExecution')(err);
        if (!cancelled) {
          setMemories([]);
          setError({ raw: err });
        }
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [executionId, attempt]);

  const heading = title ?? c.linked_memories_title;
  const columns = useMemo<TableColumn<PersonaMemory>[]>(() => [
    {
      key: 'title',
      label: c.col_memory,
      width: 'minmax(0, 1fr)',
      render: (m) => nameCell(m.title, tokenLabel(t, 'memory_tier', m.tier), m.title),
    },
    {
      key: 'category',
      label: c.col_category,
      width: 'minmax(0, 9rem)',
      render: (m) => <Cell value={tokenLabel(t, 'memory_category', m.category)} />,
    },
    {
      key: 'content',
      label: t.common.description,
      width: 'minmax(0, 1.4fr)',
      render: (m) => <Cell value={m.content} hint={m.content} />,
    },
    {
      key: 'importance',
      // 'Importance' already exists in this section and in all 14 locales.
      label: t.overview.memory_detail.importance_label,
      width: 'minmax(0, 6rem)',
      align: 'right' as const,
      render: (m) => {
        // A row without a score draws no strip rather than five empty units.
        const importance = Number.isFinite(m.importance)
          ? Math.min(IMPORTANCE_MAX, Math.max(0, Math.round(m.importance)))
          : null;
        if (importance == null) return null;
        return (
          <span className="inline-flex justify-end w-full">
            <UnitStrip
              size="s"
              label={tx(c.linked_memories_importance, { value: importance, max: IMPORTANCE_MAX })}
              segments={[{ n: importance, tone: 'primary' }, { n: IMPORTANCE_MAX - importance, tone: 'neutral', glyph: 'empty' }]}
            />
          </span>
        );
      },
    },
  ], [c.col_category, c.col_memory, c.linked_memories_importance, t, tx]);

  const failure = error ? resolveErrorTranslated(t, extractMessage(error.raw) || null) : null;
  return (
    <Tile
      span={span}
      title={heading}
      count={loading || failure ? undefined : memories.length}
      actions={actions}
      footer={footer}
      testId="cockpit-widget-linked_memories"
      error={failure ? {
        title: failure.message,
        hint: failure.suggestion,
        action: <KitButton onClick={retry}>{t.common.retry}</KitButton>,
      } : undefined}
    >
      <WidgetTable<PersonaMemory>
        columns={columns}
        rows={memories}
        getRowKey={(m) => m.id}
        rowTone={(m) => TIER_TONE[m.tier] ?? 'neutral'}
        emptyTitle={c.linked_memories_empty}
        label={heading}
        cap={CAP}
        isLoading={loading}
        testId="cockpit-linked-memories-table"
      />
    </Tile>
  );
}
