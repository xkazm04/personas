import { useMemo } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { Hint, ListRow, Rows, Tile, type RowColumn } from '@/features/shared/components/kit';
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
 * One kit Tile, one row per decision in the order they were taken (the order is the sequence, so
 * no timeline rail is drawn), reading down declared columns (kit grow-4): the topic emphasised,
 * the choice in its own column at regular weight, the rationale in the next with the full text in
 * a Hint, the time in the row's time column. They used to be one run-on name and a meta line
 * under it, which told the eye nothing about which part was the choice. The "Saved" note is the
 * tile's meta.
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
  const c = t.overview.cockpit;
  const empty = decisions.length === 0;
  // The rationale drops first on a narrow tile: the Hint still carries it in full.
  const columns: RowColumn[] = [
    { head: c.col_choice, width: '1fr' },
    { head: c.col_why, width: '1.4fr', collapse: true },
  ];
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
      <Rows count={decisions.length} cap={CAP} label={heading} empty={{ title: t.athena.decision_log_empty }} columns={columns} nameHead={c.col_decision}>
        {decisions.map((d, i) => (
          <ListRow
            key={`${d.label}-${i}`}
            size="line"
            name={<span data-decision-index={i}>{d.label}</span>}
            cells={[
              <span key="c" className="k-regular">{d.choice}</span>,
              d.rationale ? <Hint key="r" content={d.rationale}><span>{d.rationale}</span></Hint> : null,
            ]}
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
