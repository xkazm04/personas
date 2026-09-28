import { useMemo } from 'react';
import { Hint, ListRow, Meta, Rows, Tile } from '@/features/shared/components/kit';
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
      <Rows count={triggers.length} empty={{ title: a.trigger_set_empty }}>
        {triggers.map((tr, i) => {
          const detail = [
            tr.condition && `${a.trigger_set_condition}: ${tr.condition}`,
            tr.grain && `${a.trigger_set_grain}: ${tr.grain}`,
            tr.idempotency_note && `${a.trigger_set_idempotency}: ${tr.idempotency_note}`,
          ].filter(Boolean).join(' · ');
          return (
            <ListRow
              key={`${tr.label}-${i}`}
              size="s"
              name={tr.label}
              meta={
                <Hint content={detail}>
                  <span className="k-ellipsis"><Meta parts={[tr.condition, tr.grain]} /></span>
                </Hint>
              }
              figures={tr.source ? <span className="k-fig typo-data k-regular k-quiet">{tr.source}</span> : undefined}
            />
          );
        })}
      </Rows>
    </Tile>
  );
}
