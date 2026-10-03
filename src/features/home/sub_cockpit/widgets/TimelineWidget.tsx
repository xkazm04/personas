import { useMemo } from 'react';

import { Tile } from '@/features/shared/components/kit';
import { useTranslation } from '@/i18n/useTranslation';
import type { CockpitWidgetProps } from '../widgetRegistry';
import { intentTone, toneLabel } from './intentColors';
import { Cell, WidgetTable, nameCell, type TableColumn } from './widgetTable';

/**
 * `timeline` — chronological events on a vertical rail. Athena uses it
 * to reconstruct how a situation developed (incident escalations, run
 * histories, schedule drift) so the user sees sequence and spacing, not
 * just a list.
 *
 * One kit Tile holding ONE `UnifiedTable` — the app's shared table (see `widgetTable.tsx`), each
 * event's meaning its row accent. The events read down three aligned columns at one row height:
 * what, what it says, when. The last is the CLOCK time ("02:04"), with the day named on the first
 * event and wherever the day changes, so the spacing between events reads off the column; a
 * relative "yesterday" on every row said nothing about sequence. **No day grouping** — the owner
 * ruled it out for this surface on 2026-10-03 ("Not needed to divide the days into groups in this
 * situation"), so the day lives in the time column rather than in a sticky header. Capped at
 * `EVENT_CAP` with "Show all N".
 *
 * Config:
 *   {
 *     "events": [
 *       {
 *         "label": "Run failed",              // required
 *         "detail": "exit 1 after 42s…",      // optional
 *         "timestamp": "2026-06-10T14:02:00Z",// optional ISO
 *         "intent": "bad"                     // "info" | "good" | "warn" | "bad"
 *       }
 *     ]
 *   }
 */
interface TimelineEvent {
  label: string;
  detail?: string;
  timestamp?: string;
  intent?: 'info' | 'good' | 'warn' | 'bad';
}

/** An event with its resolved clock time and a key stable across re-renders. */
interface TimelineRow extends TimelineEvent {
  key: string;
  clock?: string;
}

const EVENT_CAP = 8;

/** Clock time per event, the day prefixed on the first event and at each day change. */
function clockTimes(events: readonly TimelineEvent[], language: string): Array<string | undefined> {
  const clock = new Intl.DateTimeFormat(language, { hour: '2-digit', minute: '2-digit' });
  const day = new Intl.DateTimeFormat(language, { weekday: 'short' });
  let prevDay = '';
  return events.map((e) => {
    const at = e.timestamp ? new Date(e.timestamp) : null;
    if (!at || Number.isNaN(at.getTime())) return undefined;
    const d = at.toDateString();
    const text = d === prevDay ? clock.format(at) : `${day.format(at)} ${clock.format(at)}`;
    prevDay = d;
    return text;
  });
}

export function TimelineWidget({ config, title, span, actions, footer }: CockpitWidgetProps) {
  const { t, language } = useTranslation();
  const c = t.overview.cockpit;
  const events = Array.isArray(config?.events) ? (config.events as TimelineEvent[]) : [];
  const heading = title ?? c.timeline_title;
  const detailed = events.some((e) => e.detail);

  // Not memoized on purpose: `events` is re-derived from `config` every render, so a memo keyed on
  // it would recompute anyway, and `UnifiedTable`'s row memo compares a plain row's own values
  // (`shallowEqualPlain`), so fresh-but-equal rows re-render nothing.
  const times = clockTimes(events, language);
  const rows: TimelineRow[] = events.map((e, i) => ({ ...e, key: `${i}-${e.label}`, clock: times[i] }));

  const columns = useMemo<TableColumn<TimelineRow>[]>(() => {
    const cols: TableColumn<TimelineRow>[] = [
      {
        key: 'label',
        label: c.col_event,
        width: detailed ? 'minmax(0, 1.2fr)' : 'minmax(0, 1fr)',
        render: (e) => nameCell(e.label, toneLabel(t, intentTone(e.intent, 'info')), e.label),
      },
    ];
    if (detailed) {
      cols.push({
        key: 'detail',
        label: t.common.description,
        width: 'minmax(0, 1.4fr)',
        render: (e) => <Cell value={e.detail} hint={e.detail} />,
      });
    }
    cols.push({
      key: 'clock',
      // `when_header` ('When') already exists in this section and in all 14 locales; the cockpit
      // block has no time head of its own and a new key would be the same word translated twice.
      label: t.overview.ipc_panel.when_header,
      width: 'minmax(0, 7rem)',
      align: 'right' as const,
      render: (e) => <Cell value={e.clock} data />,
    });
    return cols;
  }, [c.col_event, detailed, t]);

  return (
    <Tile span={span} title={heading} count={events.length || undefined} actions={actions} footer={footer} testId="cockpit-timeline">
      <WidgetTable<TimelineRow>
        columns={columns}
        rows={rows}
        getRowKey={(e) => e.key}
        rowTone={(e) => intentTone(e.intent, 'info')}
        emptyTitle={c.widget_empty}
        label={heading}
        cap={EVENT_CAP}
        testId="cockpit-timeline-table"
      />
    </Tile>
  );
}
