// The docs change log, by day: under each day's head (Today, Yesterday, a
// date, with its count) the changes that recorded a docs outcome - the outcome
// on the spine and as the module's pill, the change's title, where it came
// from and when - and the docs step's note for it in full under the row.
// Pressing a change opens it (`DocChangeModal`). The newest LOG_CAP changes
// show first; the rest are one press away.
import { Fragment, useMemo, useState } from 'react';

import { Button } from '@/features/shared/components/buttons';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { ListRow, Rows } from '@/features/shared/components/kit';
import { useTranslation } from '@/i18n/useTranslation';

import { outcomeLabel, sourceKindLabel } from '../../../journey/journeyLabels';
import type { EvidenceRow } from '../../blocks/evidenceRows';
import { useLifecycleViewModel } from '../../context';
import { Count } from '../../system/Count';
import { RHYTHM } from '../../system/lcSurface';
import { LT } from '../../system/lcType';
import { OutcomePill } from '../../system/Pill';
import { OUTCOME_MARK } from '../EvidenceRows';
import { dayKey, daysAgo, groupByDay, type LogDay } from './logModel';

export const LOG_CAP = 12;

function useDayLabel() {
  const { dl } = useLifecycleViewModel();
  const { language } = useTranslation();
  const timeZone = useMemo(() => new Intl.DateTimeFormat(language).resolvedOptions().timeZone, [language]);
  const date = useMemo(() => new Intl.DateTimeFormat(language, { weekday: 'short', month: 'short', day: 'numeric', timeZone }), [language, timeZone]);
  const today = dayKey(new Date().toISOString(), timeZone);
  const label = (day: LogDay): string => {
    const ago = daysAgo(day.key, today);
    if (ago === 0) return dl.lcx7_today;
    if (ago === 1) return dl.lcx7_yesterday;
    return ago == null ? dl.lcx7_day_unknown : date.format(new Date(day.rows[0]!.item.occurredAt));
  };
  return { timeZone, label };
}

function LogRow({ r, onOpen }: { r: EvidenceRow; onOpen: (row: EvidenceRow) => void }) {
  const { dl } = useLifecycleViewModel();
  return (
    <Fragment>
      <ListRow
        name={r.item.title}
        meta={<><span>{sourceKindLabel(dl, r.item.sourceKind)}</span><span className={LT.code}>{r.item.sourceRef}</span></>}
        mark={{ ...OUTCOME_MARK[r.outcome], label: outcomeLabel(dl, r.outcome) }}
        figures={<OutcomePill outcome={r.outcome} />}
        time={<RelativeTime timestamp={r.item.occurredAt} />}
        onPress={() => onOpen(r)}
        testId={`lc2-docs-log-row-${r.key}`}
      />
      {r.detail && <p className={`pb-3 pl-14 pr-4 ${LT.row}`} data-testid={`lc2-docs-log-detail-${r.key}`}>{r.detail}</p>}
    </Fragment>
  );
}

export function DocsLog({ rows, onOpen }: { rows: EvidenceRow[]; onOpen: (row: EvidenceRow) => void }) {
  const { dl, tx } = useLifecycleViewModel();
  const [all, setAll] = useState(false);
  const { timeZone, label } = useDayLabel();
  const days = useMemo(() => groupByDay(all ? rows : rows.slice(0, LOG_CAP), timeZone), [rows, all, timeZone]);
  return (
    <div className={RHYTHM.block} data-testid="lc2-docs-log">
      {rows.length === 0 && <Rows count={0} empty={{ title: dl.lc2_docs_log_empty }}>{null}</Rows>}
      {days.map((d, i) => (
        <section key={`${d.key}-${i}`} aria-label={label(d)} className={RHYTHM.tight} data-testid={`lcx7-log-day-${d.key || 'unknown'}`}>
          {/* On the kit reading line, where the rows under it start their names. */}
          <h4 className={`flex items-center gap-2 ${LT.eyebrow}`} style={{ paddingInlineStart: 'var(--gutter)' }}>
            {label(d)}
            <Count value={d.rows.length} />
          </h4>
          <Rows count={d.rows.length} empty={{ title: '' }}>
            {d.rows.map((r) => <LogRow key={r.key} r={r} onOpen={onOpen} />)}
          </Rows>
        </section>
      ))}
      {rows.length > LOG_CAP && (
        <Button variant="ghost" size="sm" onClick={() => setAll((a) => !a)} aria-expanded={all} data-testid="lcx7-log-all">
          {all ? dl.lcx7_log_fewer : tx(dl.lcx7_log_all, { count: rows.length })}
        </Button>
      )}
    </div>
  );
}
