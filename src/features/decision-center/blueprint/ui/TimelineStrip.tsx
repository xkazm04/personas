import { useMemo } from 'react';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { useSheet } from '../controller/SheetContext';

/**
 * The timeline strip (bp BaseBar): the product's revision log as ticks from its first event to now, the stage
 * changes tall, the additions short and green, a retirement red; the revision count, the date of the last event
 * and when the last scan ended.
 */
export function TimelineStrip() {
  const s = useSheet();
  const { B, tx, language } = s.text;
  const ev = s.plan.S.events;
  const model = useMemo(() => {
    const ats = ev.map((e) => Date.parse(e.at)).filter((t) => !Number.isNaN(t));
    const t0 = ats.length ? Math.min(...ats) : 0, t1 = ats.length ? Math.max(...ats) : 1, span = Math.max(1, t1 - t0);
    return {
      t1, revs: ev.filter((e) => e.type === 'stage').length,
      ticks: ev.map((e) => ({ k: e.at + e.type + (e.feature ?? ''), x: ((Date.parse(e.at) - t0) / span) * 100, cls: e.to === 'deprecated' ? 'dep' : e.type === 'feature-added' ? 'add' : 'stage' })),
    };
  }, [ev]);
  const day = model.t1 ? new Intl.DateTimeFormat(language, { month: 'short', day: 'numeric' }).format(new Date(model.t1)) : '';
  return (
    <div className="bp-tl typo-code" data-testid="blueprint-timeline">
      <span className="typo-label">{B.timeline}</span>
      <span><b>{B.now}</b> {tx(B.rev, { n: model.revs })} {'·'} {day}</span>
      <span>{B.scan_done} <RelativeTime timestamp={s.work.lastRun} fallback={B.never} showTooltip={false} /></span>
      <span className="bp-strip" aria-hidden="true">
        {model.ticks.map((t) => <i key={t.k} className={t.cls} style={{ left: `${t.x.toFixed(2)}%` }} />)}
        <span className="bp-now" />
      </span>
      <span>{tx(B.events, { count: ev.length })}</span>
    </div>
  );
}
