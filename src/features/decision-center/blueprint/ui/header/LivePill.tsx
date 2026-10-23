import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { useSheet } from '../../controller/SheetContext';

const HOUR = 3_600_000;

/** The pill's tone (bp LivePill: on = mint, off = amber): fresh under an hour, stale past a day or never scanned. */
export function scanTone(at: string | null | undefined, now: number): 'on' | 'off' | '' {
  const t = at ? Date.parse(at) : NaN;
  if (Number.isNaN(t)) return 'off';
  const age = now - t;
  return age < HOUR ? 'on' : age > 24 * HOUR ? 'off' : '';
}

/**
 * The last-scan pill (bp Header LivePill, blueprint.css:370-376): "LAST SCAN <relative>" from `data.lastRunAt`, the
 * store's own latest run when the source does not say. The time renders through the shared RelativeTime, in the
 * app's language.
 */
export function LivePill() {
  const s = useSheet();
  const { B } = s.text;
  const at = s.data.lastRunAt ?? s.work.lastRun;
  const tone = scanTone(at, Date.now());
  return (
    <span className={`bp-live${tone ? ' ' + tone : ''}`} role="status" data-testid="blueprint-scan" data-tone={tone || 'idle'}>
      <i aria-hidden="true" />
      {at ? <>{B.last_scan} <RelativeTime timestamp={at} fallback={B.never} showTooltip={false} /></> : B.no_scan_yet}
    </span>
  );
}
