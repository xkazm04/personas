import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { useSheet } from '../../controller/SheetContext';
import { fmtDay } from './dates';
import { useTime } from './useSlider';

/**
 * The panel's clock box (bp BaseBar Clock / LiveClock): what time the plan is drawn at. A drawing set has no running
 * hour, so the clock is the as-of date (26 px mono), its revision, NOW or HISTORY, and the latest scan run beneath.
 * EDIT (port): bp's play, speed and replay controls drive its simulation and are not brought.
 */
export function Clock() {
  const s = useSheet(), { B, tx, language } = s.text, { t, now, rev } = useTime();
  const runs = s.work.runs, latest = runs.length ? runs.reduce((a, r) => (r.updated_at > a.updated_at ? r : a)) : null;
  const at = s.data.lastRunAt ?? s.work.lastRun;
  const st = latest ? { running: B.tl_running, done: B.tl_done, failed: B.tl_failed, aborted: B.tl_aborted }[latest.status] : B.tl_none;
  return (
    <div className="tl-clock">
      <div className="t"><span>{B.tl_as_of}</span><span className={'tl-st' + (now ? '' : ' warn')}>{now ? B.now : B.tl_history_state}</span></div>
      <div className="hm">{fmtDay(language, t)}<small>{tx(B.rev, { n: rev })}</small></div>
      <div className="lv">
        <span>{B.tl_scan} {st}{at ? ' ·' : ''}</span>
        {at && <span><RelativeTime timestamp={at} fallback={B.never} showTooltip={false} /></span>}
      </div>
    </div>
  );
}
