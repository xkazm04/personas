import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { useSheet } from '../controller/SheetContext';
import { Hairline } from './timeline/Hairline';

/**
 * The collapsed timeline (bp timeline/Strip.tsx, timeline.css): one 28 px strip along the bottom that still tells the
 * essentials: "▴ TIMELINE [T]", where in time the plan is ("NOW", the revision and the as-of date), the scan's run
 * status and age, and the hairline of the revision history. Expanding it and travelling in time are Stage D: the
 * strip is drawn, not yet pressed.
 */
export function TimelineStrip() {
  const s = useSheet();
  const { B, tx, language } = s.text;
  const S = s.plan.S;
  const rev = Math.max(1, S.weeks.filter((w) => w <= S.asOf).length);
  const date = S.asOf ? new Intl.DateTimeFormat(language, { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(S.asOf + 'T00:00:00Z')) : '';
  const runs = s.work.runs, latest = runs.length ? runs.reduce((a, r) => (r.updated_at > a.updated_at ? r : a)) : null;
  const running = latest?.status === 'running';
  const at = s.data.lastRunAt ?? s.work.lastRun;
  return (
    <div className="bp-tl" data-testid="blueprint-timeline">
      <span className="tl-exp"><span className="tl-chev" aria-hidden="true">{'▴'}</span>{B.timeline}<kbd aria-hidden="true">T</kbd></span>
      <span className="tl-pos"><b>{B.now}</b><span className="tl-dim">{tx(B.rev, { n: rev })} {'·'} {date}</span></span>
      <span className="tl-clk">
        <span className="tl-k">{B.tl_scan}</span>
        <span className={`tl-st${running ? ' on' : ''}`}>{latest ? { running: B.tl_running, done: B.tl_done, failed: B.tl_failed, aborted: B.tl_aborted }[latest.status] : B.tl_none}</span>
        {at && <span className="tl-dim tl-ago"><RelativeTime timestamp={at} fallback={B.never} showTooltip={false} /></span>}
      </span>
      <Hairline weeks={S.weeks} snapshots={S.snapshots} asOf={S.asOf} label={tx(B.tl_history, { count: S.weeks.length })} />
    </div>
  );
}
