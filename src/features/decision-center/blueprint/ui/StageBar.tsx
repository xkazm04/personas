import type { Counts } from '../model/aggregates';

/** The stage bar as the plan prints it above each wing (bp): built solid, partly open half, being built hatched, on paper faint, demolish red. */
export function StageBar({ c }: { c: Counts }) {
  const seg = (n: number, cls: string) => (n > 0 ? <i className={cls} style={{ flex: n }} /> : null);
  return (
    <span className="bp-sbar" aria-hidden="true">
      {seg(c.live, 'live')}{seg(c.flagged, 'flag')}{seg(c.build, 'build')}{seg(c.paper + c.none, 'paper')}{seg(c.dep, 'dep')}
    </span>
  );
}
