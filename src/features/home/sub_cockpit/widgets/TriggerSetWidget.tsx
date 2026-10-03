import { useMemo } from 'react';
import { Hint, ListRow, Rows, Tile, type RowColumn } from '@/features/shared/components/kit';
import { useTranslation } from '@/i18n/useTranslation';
import type { CockpitWidgetProps } from '../widgetRegistry';

interface Trigger {
  label: string;
  source: string;
  condition: string;
  grain?: string;
  idempotency_note?: string;
}

/**
 * Inline chat-card Athena emits via `show_trigger_set { intent, triggers }`. Each trigger answers
 * the cycle-6 doctrine's right-grain test: one trigger condition produces one persona response
 * shape. Sibling of `show_use_case_set` (when-it-fires vs what-it-handles).
 *
 * One kit Tile, one row per trigger: the label is the row's one emphasis, the condition and the
 * grain its meta, the source a regular figure on the right. The idempotency note is design
 * rationale, so it lives in the row's Hint with the full wording (a truncated meta never hides
 * text silently). The intent is not repeated here: the surface shows it once.
 */
export function TriggerSetWidget({ config, title, span, actions, footer }: CockpitWidgetProps) {
  const { t } = useTranslation();
  const a = t.athena;
  const triggers = useMemo<Trigger[]>(() => {
    const raw = config?.triggers;
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((tr): tr is Record<string, unknown> => typeof tr === 'object' && tr !== null)
      .map((tr) => ({
        label: typeof tr.label === 'string' ? tr.label : '',
        source: typeof tr.source === 'string' ? tr.source : '',
        condition: typeof tr.condition === 'string' ? tr.condition : '',
        grain: typeof tr.grain === 'string' ? tr.grain : undefined,
        idempotency_note: typeof tr.idempotency_note === 'string' ? tr.idempotency_note : undefined,
      }))
      .filter((tr) => tr.label.length > 0);
  }, [config]);

  const c = t.overview.cockpit;
  // The condition and the grain are what a trigger IS; the source is one short word, so it takes
  // a fixed track and the detail takes the rest of the band.
  const columns: RowColumn[] = [
    { head: c.col_source, width: '7rem' },
    { head: c.col_detail, width: '1.6fr' },
  ];
  return (
    <Tile
      span={span}
      title={title || a.trigger_set_title}
      count={triggers.length || undefined}
      actions={actions}
      footer={footer}
      state={triggers.length === 0 ? 'empty' : undefined}
      empty={{ title: a.trigger_set_empty }}
      testId="companion-trigger-set-widget"
    >
      <Rows count={triggers.length} empty={{ title: a.trigger_set_empty }} columns={columns} nameHead={c.col_trigger}>
        {triggers.map((tr, i) => {
          const detail = [
            tr.condition && `${a.trigger_set_condition}: ${tr.condition}`,
            tr.grain && `${a.trigger_set_grain}: ${tr.grain}`,
            tr.idempotency_note && `${a.trigger_set_idempotency}: ${tr.idempotency_note}`,
          ].filter(Boolean).join(' · ');
          return (
            <ListRow
              key={`${tr.label}-${i}`}
              size="line"
              name={tr.label}
              cells={[
                tr.source ? <span key="s" className="typo-data k-regular k-quiet">{tr.source}</span> : null,
                <Hint key="d" content={detail}>
                  <span>{[tr.condition, tr.grain].filter(Boolean).join(' · ')}</span>
                </Hint>,
              ]}
            />
          );
        })}
      </Rows>
    </Tile>
  );
}
