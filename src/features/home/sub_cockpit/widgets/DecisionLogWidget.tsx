import { useMemo } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { Hint, Tile } from '@/features/shared/components/kit';
import type { CockpitWidgetProps } from '../widgetRegistry';
import { Cell, WidgetTable, nameCell, type TableColumn } from './widgetTable';

interface Decision {
  label: string;
  choice: string;
  rationale: string;
  timestamp?: string;
}

interface DecisionRow extends Decision {
  key: string;
  index: number;
  when?: string;
}

/** Rows shown before "Show all" (home-2 contract: grid lists cap at 6-8). */
const CAP = 6;

/**
 * Inline chat-card Athena emits via `show_decision_log { intent, decisions }`.
 * Captures the design choices made during the current conversation so
 * the user (and future-Athena) can retrace reasoning later without
 * re-running the conversation.
 *
 * One kit Tile holding ONE `UnifiedTable` — the app's shared table (see `widgetTable.tsx`) — one
 * row per decision in the order they were taken (the order is the sequence, so no timeline rail
 * is drawn), reading down four named columns: the topic emphasised, the choice, the rationale with
 * the full text in a Hint, and when. They used to be one run-on name and a meta line under it,
 * which told the eye nothing about which part was the choice. The "Saved" note is the tile's meta.
 */
export function DecisionLogWidget({ config, title, span, actions, footer }: CockpitWidgetProps) {
  const { t } = useTranslation();
  const decisions = useMemo<DecisionRow[]>(() => {
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
      .filter((d) => d.label.length > 0 && d.choice.length > 0)
      .map((d, i) => ({
        ...d,
        key: `${d.label}-${i}`,
        index: i,
        when: d.timestamp ? prettyTime(d.timestamp) : undefined,
      }));
  }, [config]);

  const heading = title || t.athena.decision_log_title;
  const c = t.overview.cockpit;
  const empty = decisions.length === 0;
  const columns = useMemo<TableColumn<DecisionRow>[]>(() => [
    {
      key: 'label',
      label: c.col_decision,
      width: 'minmax(0, 1fr)',
      render: (d) => <span className="block min-w-0" data-decision-index={d.index}>{nameCell(d.label, undefined, d.label)}</span>,
    },
    {
      key: 'choice',
      label: c.col_choice,
      width: 'minmax(0, 1fr)',
      render: (d) => <Cell value={d.choice} hint={d.choice} />,
    },
    {
      key: 'rationale',
      label: c.col_why,
      width: 'minmax(0, 1.4fr)',
      render: (d) => <Cell value={d.rationale} hint={d.rationale} />,
    },
    {
      key: 'when',
      // 'When' already exists in this section and in all 14 locales; a cockpit-local key would be
      // the same word translated a second time.
      label: t.overview.ipc_panel.when_header,
      width: 'minmax(0, 6rem)',
      align: 'right' as const,
      render: (d) => <Cell value={d.when} data />,
    },
  ], [c.col_choice, c.col_decision, c.col_why, t.overview.ipc_panel.when_header]);

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
      <WidgetTable<DecisionRow>
        columns={columns}
        rows={decisions}
        getRowKey={(d) => d.key}
        emptyTitle={t.athena.decision_log_empty}
        label={heading}
        cap={CAP}
        testId="companion-decision-log-table"
      />
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
