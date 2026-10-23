import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { useSheet } from '../controller/SheetContext';
import { Press } from './Press';
import { fmtDay } from './timeline/dates';
import { Hairline } from './timeline/Hairline';
import { useTime } from './timeline/useSlider';

/**
 * The collapsed timeline (bp timeline/Strip.tsx, timeline.css): one 28 px strip along the bottom that still tells the
 * essentials: "▴ TIMELINE [T]" (pressed, or T, opens the panel above it), where in time the plan is (NOW, or the
 * travelled date with BACK TO NOW), the scan's run status and age, and the hairline of the revision history, which is
 * a slider: drag it to travel. Travelled, the strip turns accent so "this is not now" cannot be missed.
 */
export function TimelineStrip() {
  const s = useSheet();
  const { B, tx, language } = s.text;
  const { t, now, rev, total } = useTime();
  const runs = s.work.runs, latest = runs.length ? runs.reduce((a, r) => (r.updated_at > a.updated_at ? r : a)) : null;
  const running = latest?.status === 'running';
  const at = s.data.lastRunAt ?? s.work.lastRun, open = s.ui.timelineOpen;
  return (
    <div className={'bp-tl' + (now ? '' : ' travel') + (open ? ' open' : '')} data-testid="blueprint-timeline">
      <Press tone="tl-exp" aria-expanded={open} aria-controls="bp-tlpanel" onClick={() => s.dispatch({ type: 'timeline' })}>
        <span className="tl-chev" aria-hidden="true">{open ? '▾' : '▴'}</span>{B.timeline}<kbd aria-hidden="true">T</kbd>
      </Press>
      {now
        ? <span className="tl-pos"><b>{B.now}</b><span className="tl-dim">{tx(B.rev, { n: rev })} {'·'} {fmtDay(language, t)}</span></span>
        : (
          <span className="tl-pos">
            <b>{tx(B.tl_viewing, { date: fmtDay(language, t) })}</b><span className="tl-dim">{tx(B.tl_rev_of, { n: rev, total })}</span>
            <Press tone="tl-back" onClick={() => s.dispatch({ type: 'asOf', date: null })} data-testid="blueprint-back-to-now">{B.tl_back} {'▸'}</Press>
          </span>
        )}
      <span className="tl-clk">
        <span className="tl-k">{B.tl_scan}</span>
        <span className={`tl-st${running ? ' on' : ''}`}>{latest ? { running: B.tl_running, done: B.tl_done, failed: B.tl_failed, aborted: B.tl_aborted }[latest.status] : B.tl_none}</span>
        {at && <span className="tl-dim tl-ago"><RelativeTime timestamp={at} fallback={B.never} showTooltip={false} /></span>}
      </span>
      <Hairline />
    </div>
  );
}
