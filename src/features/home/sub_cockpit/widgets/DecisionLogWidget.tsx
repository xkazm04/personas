import { useMemo } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { Hint, ListRow, Rows, Tile } from '@/features/shared/components/kit';
import type { CockpitWidgetProps } from '../widgetRegistry';

interface Decision {
  label: string;
  choice: string;
  rationale: string;
  timestamp?: string;
}

/** Rows shown before "Show all" (home-2 contract: grid lists cap at 6-8). */
const CAP = 6;

/**
 * Inline chat-card Athena emits via `show_decision_log { intent, decisions }`.
 * Captures the design choices made during the current conversation so
 * the user (and future-Athena) can retrace reasoning later without
 * re-running the conversation.
 *
 * One kit Tile, one row per decision in the order they were taken (the
 * order is the sequence, so no timeline rail is drawn): the topic
 * emphasised, the choice beside it at regular
 * weight, the rationale as the row's meta with the full text in a Hint,
 * the time in the row's time column. The "Saved" note is the tile's meta.
 */
export function DecisionLogWidget({ config, title, span, actions, footer }: CockpitWidgetProps) {
  const { t } = useTranslation();
  const decisions = useMemo<Decision[]>(() => {
    const raw = config?.decisions;
    if (!Array.isArray(raw)) return [];
    return raw
      .filter(
        (d): d is Record<string, unknown> => typeof d === 'object' && d !== null,
      )
      .map((d) => ({
        label: typeof d.label === 'string' ? d.label : '',
        choice: typeof d.choice === 'string' ? d.choice : '',
        rationale: typeof d.rationale === 'string' ? d.rationale : '',
        timestamp: typeof d.timestamp === 'string' ? d.timestamp : undefined,
      }))
      .filter((d) => d.label.length > 0 && d.choice.length > 0);
  }, [config]);

  const heading = title || t.athena.decision_log_title;
  const empty = decisions.length === 0;
  return (
    <Tile
      span={span}
      title={heading}
      count={empty ? undefined : decisions.length}
      meta={empty ? undefined : (
        <Hint content={t.athena.decision_log_persisted_tooltip} focusable>
          <span>{t.athena.decision_log_persisted_badge}</span>
        </Hint>
      )}
      actions={actions}
      footer={footer}
      state={empty ? 'empty' : undefined}
      empty={{ title: t.athena.decision_log_empty }}
      testId="companion-decision-log-widget"
    >
      <Rows count={decisions.length} cap={CAP} label={heading} empty={{ title: t.athena.decision_log_empty }}>
        {decisions.map((d, i) => (
          <ListRow
            key={`${d.label}-${i}`}
            size="s"
            name={(
              <span data-decision-index={i}>
                <span>{d.label}</span>
                <span className="k-quiet k-regular" aria-hidden="true">{' › '}</span>
                <span className="k-regular">{d.choice}</span>
              </span>
            )}
            meta={d.rationale ? <Hint content={d.rationale}><span className="k-ellipsis">{d.rationale}</span></Hint> : undefined}
            time={d.timestamp ? prettyTime(d.timestamp) : undefined}
          />
        ))}
      </Rows>
    </Tile>
  );
}

/**
 * Cheap timestamp render - full ISO is too noisy in a row; we keep
 * just hh:mm if today, otherwise the date. The widget doesn't
 * own a richer relative-time formatter, and the chat scroll already
 * implies recency.
 */
function prettyTime(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const now = new Date();
    const sameDay =
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate();
    if (sameDay) {
      return d.toLocaleTimeString(undefined, {
        hour: '2-digit',
        minute: '2-digit',
      });
    }
    return d.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return iso;
  }
}
