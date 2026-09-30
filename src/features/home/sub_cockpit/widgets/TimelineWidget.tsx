import { ListRow, Rows, Tile } from '@/features/shared/components/kit';
import { useTranslation } from '@/i18n/useTranslation';
import type { CockpitWidgetProps } from '../widgetRegistry';
import { intentTone, toneLabel } from './intentColors';

/**
 * `timeline` — chronological events on a vertical rail. Athena uses it
 * to reconstruct how a situation developed (incident escalations, run
 * histories, schedule drift) so the user sees sequence and spacing, not
 * just a list.
 *
 * Rendered as one kit Tile of kit rows on the spine, each event's meaning as its Mark. The time
 * column is the CLOCK time ("02:04"), with the day named on the first event and wherever the
 * day changes, so the spacing between events reads off the column; a relative "yesterday" on
 * every row said nothing about sequence. Capped at `EVENT_CAP` with "Show all N".
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
  const events = Array.isArray(config?.events) ? (config.events as TimelineEvent[]) : [];
  const times = clockTimes(events, language);
  const heading = title ?? t.overview.cockpit.timeline_title;
  const size = events.some((e) => e.detail) ? 's' : 'line';
  return (
    <Tile span={span} title={heading} count={events.length || undefined} actions={actions} footer={footer} testId="cockpit-timeline">
      <Rows count={events.length} cap={EVENT_CAP} empty={{ title: t.overview.cockpit.widget_empty }} label={heading}>
        {events.map((evt, i) => {
          const tone = intentTone(evt.intent, 'info');
          return (
            <ListRow
              key={`${i}-${evt.label}`}
              size={size}
              name={evt.label}
              meta={evt.detail}
              mark={{ tone, glyph: 'soft', label: toneLabel(t, tone) }}
              time={times[i]}
            />
          );
        })}
      </Rows>
    </Tile>
  );
}
