// The headline every overview surface opens with, and the crumb that says
// which altitude you are reading it at.
//
// Two rows. The top row is the one number that matters and where you are:
// "13.8% coverage", then the altitude crumb. The number is COVERAGE, not
// health: in this estate 144 of 1,044 KPIs have ever been read, so a screen
// that led with a state colour would be leading with a claim about 14% of
// itself. The bottom row is the rest of the denominator as small stat cards,
// the figure dominant and its label underneath, absence included.
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
    <header className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <h2 className="flex items-baseline gap-2">
          <span className="typo-hero text-foreground tabular-nums">{`${coveragePct(tally)}%`}</span>
          <span className="typo-heading-lg text-primary">{o.headline_coverage}</span>
        </h2>
        <nav className="flex flex-wrap items-center gap-1" aria-label={o.altitude_portfolio}>
          <Crumb
            label={o.altitude_portfolio}
            detail={tx(o.headline_scope, { projects: estate.projects.length, groups: estate.groupCount })}
            active={!project}
            onClick={project ? onClimb : undefined}
          />
          {project && (
            <>
              <span aria-hidden="true" className="typo-caption text-foreground">
                /
              </span>
              <Crumb
                label={project.label}
                detail={tx(o.headline_project_scope, { groups: project.groups.length, total: project.tally.total })}
                active
              />
            </>
          )}
        </nav>
      </div>

      <CoverageBar tally={tally} height={6} />

      <dl className="grid grid-cols-[repeat(auto-fit,minmax(7.5rem,1fr))] gap-2">
        <Stat label={o.stat_observed} value={`${tally.measured}/${tally.total}`} tone="var(--primary)" />
        <Stat label={o.count_off_track} value={tally.offTrack} tone="var(--status-error)" />
        <Stat label={o.count_on_track} value={tally.onTrack} tone="var(--primary)" />
        <Stat label={o.count_met} value={tally.met} tone="var(--status-success)" />
        <Stat label={o.count_no_verdict} value={tally.unpaced} tone="var(--status-warning)" />
        <Stat label={o.count_stale} value={tally.stale} tone="var(--status-info)" />
        <Stat label={o.count_never_read} value={tally.unmeasured} tone="var(--muted-foreground)" />
      </dl>
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
  const className = `rounded-interactive px-2 py-1 text-left transition-colors ${
    active ? 'bg-secondary/40' : 'hover:bg-secondary/30'
  }`;
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

/** One stat card: the figure dominant, its label underneath, a tone line on
 *  top. `value` is nullable ON PURPOSE - "nobody measured it" and "it is zero"
 *  are different claims, so the card has to be able to say the first one
 *  rather than force every caller to reach for a 0 (golden path:
 *  metric-tile.md). A zero stays quiet: the tone only lights a count that has
 *  something in it. */
function Stat({ label, value, tone }: { label: string; value: number | string | null; tone: string }) {
  const { t } = useTranslation();
  const lit = typeof value === 'string' || (value != null && value > 0);
  return (
    // Label first in the DOM so a screen reader hears "Off track, 0"; the
    // column is reversed so the eye meets the figure first.
    <div className="relative flex flex-col-reverse overflow-hidden rounded-card border border-card-border bg-gradient-to-b from-secondary/40 to-secondary/10 px-3 py-2">
      <span
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-px"
        style={{ background: `linear-gradient(90deg, ${tone}, transparent 75%)`, opacity: lit ? 0.9 : 0.3 }}
      />
      <dt className="typo-caption text-foreground">{label}</dt>
      <dd className="typo-data-lg tabular-nums leading-tight" style={{ color: lit ? tone : 'var(--foreground)' }}>
        {value ?? t.kpis.overview.read_never}
      </dd>
    </div>
  );
}
