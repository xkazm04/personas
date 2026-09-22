// The headline every overview surface opens with, and the crumb that says
// which altitude you are reading it at.
//
// The number in front is COVERAGE, not health: in this estate 144 of 1,044
// KPIs have ever been read, so a screen that leads with a state colour would
// be leading with a claim about 14 % of itself. The counts beside it are the
// whole denominator, absence included.
import { useTranslation } from '@/i18n/useTranslation';

import type { Estate, EstateProject, KpiTally } from './kpiEstate';
import { CoverageBar } from './CoverageBar';

function coveragePct(tally: KpiTally): string {
  const pct = tally.coverage * 100;
  return pct > 0 && pct < 20 ? pct.toFixed(1) : String(Math.round(pct));
}

export function EstateHeadline({
  estate,
  project,
  onClimb,
}: {
  estate: Estate;
  project: EstateProject | null;
  onClimb: () => void;
}) {
  const { t, tx } = useTranslation();
  const o = t.kpis.overview;
  const tally = project ? project.tally : estate.tally;

  return (
    <header className="space-y-2.5">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="typo-hero text-foreground tabular-nums">{`${coveragePct(tally)}%`}</span>
        <h2 className="typo-title-lg text-foreground">
          {project ? tx(o.headline_project, { project: project.label }) : o.headline_portfolio}
        </h2>
        <p className="typo-body text-foreground">
          {tx(o.headline_counts, { measured: tally.measured, total: tally.total })}
        </p>
      </div>

      <CoverageBar tally={tally} height={10} />

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <Crumb
          label={o.altitude_portfolio}
          detail={tx(o.headline_scope, { projects: estate.projects.length, groups: estate.groupCount })}
          active={!project}
          onClick={project ? onClimb : undefined}
        />
        {project && (
          <Crumb
            label={project.label}
            detail={tx(o.headline_project_scope, { groups: project.groups.length, total: project.tally.total })}
            active
          />
        )}
        <dl className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <Count label={o.count_off_track} value={tally.offTrack} tone="var(--status-error)" />
          <Count label={o.count_on_track} value={tally.onTrack} tone="var(--primary)" />
          <Count label={o.count_met} value={tally.met} tone="var(--status-success)" />
          <Count label={o.count_no_verdict} value={tally.unpaced} tone="var(--status-warning)" />
          <Count label={o.count_stale} value={tally.stale} tone="var(--status-info)" />
          <Count label={o.count_never_read} value={tally.unmeasured} tone="var(--muted-foreground)" />
        </dl>
      </div>
    </header>
  );
}

function Crumb({
  label,
  detail,
  active,
  onClick,
}: {
  label: string;
  detail: string;
  active: boolean;
  onClick?: () => void;
}) {
  const className = `rounded-interactive px-2 py-1 text-left ${
    active ? 'bg-secondary/40' : 'hover:bg-secondary/30'
  } transition-colors`;
  const body = (
    <>
      <span className="typo-title text-foreground">{label}</span>{' '}
      <span className="typo-caption text-foreground">{detail}</span>
    </>
  );
  if (!onClick) {
    return (
      <span className={className} aria-current={active ? 'true' : undefined}>
        {body}
      </span>
    );
  }
  return (
    <button type="button" onClick={onClick} className={`${className} focus-ring`}>
      {body}
    </button>
  );
}

/** One labelled count. `value` is nullable ON PURPOSE: this module's whole
 *  subject is that "nobody measured it" and "it is zero" are different claims,
 *  so the tile that prints a quantity has to be able to say the first one
 *  rather than force every caller to reach for a 0 (golden path:
 *  metric-tile.md). */
function Count({ label, value, tone }: { label: string; value: number | null; tone: string }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-baseline gap-1.5">
      <dt className="typo-caption text-foreground">{label}</dt>
      <dd
        className="typo-data text-foreground tabular-nums"
        style={{ color: value != null && value > 0 ? tone : undefined }}
      >
        {value ?? t.kpis.overview.read_never}
      </dd>
    </div>
  );
}
