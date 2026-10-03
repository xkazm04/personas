import { ListRow, Rows, Tile, type Glyph, type RowColumn, type Tone } from '@/features/shared/components/kit';
import { useTranslation } from '@/i18n/useTranslation';
import type { Translations } from '@/i18n/en';
import type { CockpitWidgetProps } from '../widgetRegistry';

/**
 * `flow_steps` — a causal / sequence chain. Athena uses it to explain
 * "what happened, then what, and what happens if you act": each step is
 * a node on the kit spine, its state drawn as the row's Mark.
 *
 * Rendered as one kit Tile of kit rows: done = success (soft), the step the user is at = the
 * theme primary, not yet = hollow, blocked = error. Not capped: a chain is read whole.
 *
 * Config:
 *   {
 *     "steps": [
 *       {
 *         "label": "Trigger fired",          // required
 *         "detail": "Sentry webhook…",       // optional second line
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

type Status = NonNullable<FlowStep['status']>;

const NODE: Record<Status, { tone: Tone; glyph: Glyph }> = {
  done: { tone: 'success', glyph: 'soft' },
  current: { tone: 'primary', glyph: 'solid' },
  pending: { tone: 'neutral', glyph: 'hollow' },
  blocked: { tone: 'error', glyph: 'solid' },
};

function statusLabel(t: Translations, s: Status): string {
  const c = t.overview.cockpit;
  return s === 'done' ? c.flow_done : s === 'current' ? c.flow_current : s === 'blocked' ? c.flow_blocked : c.flow_pending;
}

export function FlowStepsWidget({ config, title, span, actions, footer }: CockpitWidgetProps) {
  const { t } = useTranslation();
  const steps = Array.isArray(config?.steps) ? (config.steps as FlowStep[]) : [];
  const heading = title ?? t.overview.cockpit.flow_title;
  const c = t.overview.cockpit;
  const detailed = steps.some((s) => s.detail);
  const columns: RowColumn[] | undefined = detailed ? [{ head: c.col_detail, width: '1.4fr' }] : undefined;
  return (
    <Tile span={span} title={heading} actions={actions} footer={footer} testId="cockpit-flow-steps">
      <Rows count={steps.length} empty={{ title: c.widget_empty }} label={heading} columns={columns} nameHead={detailed ? c.col_step : undefined}>
        {steps.map((step, i) => {
          const status: Status = step.status && step.status in NODE ? step.status : 'pending';
          const node = NODE[status];
          return (
            <ListRow
              key={`${i}-${step.label}`}
              size="line"
              name={step.label}
              cells={[step.detail]}
              mark={{ ...node, label: statusLabel(t, status) }}
              state={status === 'current' ? 'selected' : undefined}
            />
          );
        })}
      </Rows>
    </Tile>
  );
}
