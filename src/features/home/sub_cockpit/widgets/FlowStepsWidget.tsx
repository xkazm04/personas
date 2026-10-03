import { useMemo } from 'react';

import { Tile, type Tone } from '@/features/shared/components/kit';
import { useTranslation } from '@/i18n/useTranslation';
import type { Translations } from '@/i18n/en';
import type { CockpitWidgetProps } from '../widgetRegistry';
import { Cell, WidgetTable, nameCell, type TableColumn } from './widgetTable';

/**
 * `flow_steps` — a causal / sequence chain. Athena uses it to explain
 * "what happened, then what, and what happens if you act": each step is
 * a row of the shared table, its state drawn as the row's left accent.
 *
 * One kit Tile holding ONE `UnifiedTable` (see `widgetTable.tsx`): done = success, the step the
 * user is at = the theme primary, not yet = the faintest rule, blocked = error. The step's own
 * sentence is the Description column beside it, never a second line (the row keeps one height).
 * A chain is read whole up to the table's default cap, past which "Show all N" expands it in
 * place - a chain Athena composes is the one row count nobody reviews, so it is bounded.
 *
 * Config:
 *   {
 *     "steps": [
 *       {
 *         "label": "Trigger fired",          // required
 *         "detail": "Sentry webhook…",       // optional
 *         "status": "done"                   // "done" | "current" | "pending" | "blocked"
 *       }
 *     ]
 *   }
 */
interface FlowStep {
  label: string;
  detail?: string;
  status?: 'done' | 'current' | 'pending' | 'blocked';
}

interface FlowRow extends FlowStep {
  key: string;
}

type Status = NonNullable<FlowStep['status']>;

const NODE: Record<Status, Tone> = {
  done: 'success',
  current: 'primary',
  pending: 'neutral',
  blocked: 'error',
};

function statusOf(step: FlowStep): Status {
  return step.status && step.status in NODE ? step.status : 'pending';
}

function statusLabel(t: Translations, s: Status): string {
  const c = t.overview.cockpit;
  return s === 'done' ? c.flow_done : s === 'current' ? c.flow_current : s === 'blocked' ? c.flow_blocked : c.flow_pending;
}

export function FlowStepsWidget({ config, title, span, actions, footer }: CockpitWidgetProps) {
  const { t } = useTranslation();
  const c = t.overview.cockpit;
  const steps = Array.isArray(config?.steps) ? (config.steps as FlowStep[]) : [];
  const heading = title ?? c.flow_title;
  const detailed = steps.some((s) => s.detail);
  const rows: FlowRow[] = steps.map((s, i) => ({ ...s, key: `${i}-${s.label}` }));

  const columns = useMemo<TableColumn<FlowRow>[]>(() => {
    const cols: TableColumn<FlowRow>[] = [
      {
        key: 'label',
        label: c.col_step,
        width: 'minmax(0, 1fr)',
        render: (step) => nameCell(step.label, statusLabel(t, statusOf(step)), step.label),
      },
    ];
    if (detailed) {
      cols.push({
        key: 'detail',
        label: t.common.description,
        width: 'minmax(0, 1.4fr)',
        render: (step) => <Cell value={step.detail} hint={step.detail} />,
      });
    }
    return cols;
  }, [c.col_step, detailed, t]);

  return (
    <Tile span={span} title={heading} actions={actions} footer={footer} testId="cockpit-flow-steps">
      <WidgetTable<FlowRow>
        columns={columns}
        rows={rows}
        getRowKey={(step) => step.key}
        rowTone={(step) => NODE[statusOf(step)]}
        emptyTitle={c.widget_empty}
        label={heading}
        testId="cockpit-flow-steps-table"
      />
    </Tile>
  );
}
