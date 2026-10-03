import { useMemo } from 'react';
import { Tile } from '@/features/shared/components/kit';
import { useTranslation } from '@/i18n/useTranslation';
import type { CockpitWidgetProps } from '../widgetRegistry';
import { Cell, WidgetTable, nameCell, type TableColumn } from './widgetTable';

interface Trigger {
  label: string;
  source: string;
  condition: string;
  grain?: string;
  idempotency_note?: string;
}

interface TriggerRow extends Trigger {
  key: string;
  /** What the row shows in its condition column. */
  reads: string;
  /** The full design rationale, on hover and focus. */
  full: string;
}

/**
 * Inline chat-card Athena emits via `show_trigger_set { intent, triggers }`. Each trigger answers
 * the cycle-6 doctrine's right-grain test: one trigger condition produces one persona response
 * shape. Sibling of `show_use_case_set` (when-it-fires vs what-it-handles).
 *
 * One kit Tile holding ONE `UnifiedTable` — the app's shared table (see `widgetTable.tsx`). Three
 * named columns: the trigger, where it comes from, and what makes it fire. The column that used
 * to be headed "Detail" now carries the head it earned ("Fires when"), the owner having removed
 * that generic head by name on 2026-10-03. The idempotency note is design rationale, so it stays
 * in the cell's Hint with the full wording (a truncated cell never hides text silently). The
 * intent is not repeated here: the surface shows it once.
 */
export function TriggerSetWidget({ config, title, span, actions, footer }: CockpitWidgetProps) {
  const { t } = useTranslation();
  const a = t.athena;
  const c = t.overview.cockpit;
  const triggers = useMemo<TriggerRow[]>(() => {
    const raw = config?.triggers;
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((tr): tr is Record<string, unknown> => typeof tr === 'object' && tr !== null)
      .map((tr, i) => {
        const label = typeof tr.label === 'string' ? tr.label : '';
        const condition = typeof tr.condition === 'string' ? tr.condition : '';
        const grain = typeof tr.grain === 'string' ? tr.grain : undefined;
        const note = typeof tr.idempotency_note === 'string' ? tr.idempotency_note : undefined;
        return {
          label,
          source: typeof tr.source === 'string' ? tr.source : '',
          condition,
          grain,
          idempotency_note: note,
          key: `${label}-${i}`,
          reads: [condition, grain].filter(Boolean).join(' · '),
          full: [
            condition && `${a.trigger_set_condition}: ${condition}`,
            grain && `${a.trigger_set_grain}: ${grain}`,
            note && `${a.trigger_set_idempotency}: ${note}`,
          ].filter(Boolean).join(' · '),
        };
      })
      .filter((tr) => tr.label.length > 0);
  }, [a.trigger_set_condition, a.trigger_set_grain, a.trigger_set_idempotency, config]);

  const heading = title || a.trigger_set_title;
  const columns = useMemo<TableColumn<TriggerRow>[]>(() => [
    {
      key: 'label',
      label: c.col_trigger,
      width: 'minmax(0, 1fr)',
      render: (tr) => nameCell(tr.label, undefined, tr.label),
    },
    {
      key: 'source',
      label: c.col_source,
      width: 'minmax(0, 8rem)',
      render: (tr) => <Cell value={tr.source} data hint={tr.source} />,
    },
    {
      key: 'condition',
      label: a.trigger_set_condition,
      width: 'minmax(0, 1.6fr)',
      render: (tr) => <Cell value={tr.reads} hint={tr.full} />,
    },
  ], [a.trigger_set_condition, c.col_source, c.col_trigger]);

  return (
    <Tile
      span={span}
      title={heading}
      count={triggers.length || undefined}
      actions={actions}
      footer={footer}
      state={triggers.length === 0 ? 'empty' : undefined}
      empty={{ title: a.trigger_set_empty }}
      testId="companion-trigger-set-widget"
    >
      <WidgetTable<TriggerRow>
        columns={columns}
        rows={triggers}
        getRowKey={(tr) => tr.key}
        emptyTitle={a.trigger_set_empty}
        label={heading}
        testId="companion-trigger-set-table"
      />
    </Tile>
  );
}
