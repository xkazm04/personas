import { useTranslation } from '@/i18n/useTranslation';
import { formatDuration } from '@/lib/utils/formatters';
import type { Station } from './engine/spine';
import { pct, stationName } from './labels';

interface SpineStationProps {
  station: Station;
  total: number;
  /** The same station measured over the whole mode, when a repository is selected. */
  cohort?: Station;
  cohortTotal?: number;
  /** 1-based rank among the stations with the most failures, when in the top three. */
  rank?: number;
  last: boolean;
}

/**
 * One station of the spine: its name alone on the left, the river in the middle (its width is
 * the share of sessions still on the path here), and on the right the two things this layer is
 * for - how much of the cohort reached the step, and how much of it failed there.
 */
export function SpineStation({ station: s, total, cohort, cohortTotal, rank, last }: SpineStationProps) {
  const { t, tx } = useTranslation();
  const p = t.companions.process;
  const share = total ? s.reached / total : 0;
  const hot = rank != null;
  // A share of nobody is not 0%: a station no session reached has no failure rate at all.
  const exitPct = s.reached ? pct(s.exits, s.reached) : null;
  const stumblePct = s.reached ? pct(s.friction, s.reached) : null;

  return (
    <li className="grid grid-cols-[minmax(9rem,13rem)_4.5rem_minmax(0,1fr)] gap-x-8" data-testid={`process-station-${s.index}`}>
      <div className="flex flex-col items-end pt-1 text-right">
        <span className={`typo-heading-lg ${hot ? 'text-status-error' : 'text-foreground'}`}>{stationName(p, s.keys)}</span>
        {hot && (
          <span className="mt-2 rounded-pill bg-status-error/15 px-2.5 py-0.5 typo-caption text-status-error">
            {tx(p.rank, { rank: rank! })}
          </span>
        )}
      </div>

      <div className="relative flex justify-center" aria-hidden="true">
        <span
          className={`absolute top-2 bottom-0 rounded-t-interactive bg-primary/20 ${last ? 'rounded-b-full' : ''}`}
          style={{ width: `${Math.max(6, Math.round(56 * share))}px` }}
        />
        <span className={`relative z-10 mt-1 h-4 w-4 rounded-full border-2 bg-background ${hot ? 'border-status-error' : 'border-primary'}`} />
      </div>

      <div className="grid grid-cols-2 gap-x-10 gap-y-2 pb-12">
        <section>
          <h3 className="typo-caption uppercase tracking-wider">{p.coverage}</h3>
          <div className="mt-1 flex items-baseline gap-3">
            <span className="typo-data-lg tabular-nums">{pct(s.reached, total)}%</span>
            <span className="typo-body tabular-nums">{tx(p.reached, { reached: s.reached, total })}</span>
          </div>
          <Bar value={share} tone="bg-primary" tick={cohort && cohortTotal ? cohort.reached / cohortTotal : undefined} />
          {cohort && cohortTotal ? (
            <p className="mt-1 typo-caption tabular-nums">{tx(p.cohort_share, { pct: `${pct(cohort.reached, cohortTotal)}%` })}</p>
          ) : null}
          {s.skipped > 0 && <p className="mt-1 typo-caption tabular-nums">{tx(p.skipped, { count: s.skipped })}</p>}
        </section>

        <section>
          <h3 className="typo-caption uppercase tracking-wider">{p.failures}</h3>
          {s.exits + s.friction === 0 ? (
            <p className="mt-2 typo-body">{p.no_failures}</p>
          ) : (
            <div className="mt-2 space-y-2">
              <FailureLine label={tx(p.left_here, { count: s.exits })} value={exitPct} tone="bg-status-error" />
              <FailureLine label={tx(p.stumbled, { count: s.friction })} value={stumblePct} tone="bg-status-warning" />
            </div>
          )}
        </section>

        {Number.isFinite(s.medWait) && (
          <p className="col-span-2 typo-caption tabular-nums">
            {tx(p.wait, { value: formatDuration(s.medWait, { unit: 's' }) })}
            {Number.isFinite(s.p75Wait) ? `  ·  ${tx(p.wait_p75, { value: formatDuration(s.p75Wait, { unit: 's' }) })}` : ''}
          </p>
        )}
      </div>
    </li>
  );
}

function Bar({ value, tone, tick }: { value: number; tone: string; tick?: number }) {
  return (
    <div className="relative mt-2 h-2 rounded-full bg-secondary/60">
      <div className={`h-2 rounded-full ${tone}`} style={{ width: `${Math.round(100 * Math.min(1, value))}%` }} />
      {tick != null && (
        <span className="absolute -top-1 h-4 w-0.5 rounded bg-foreground/70" style={{ left: `${Math.round(100 * Math.min(1, tick))}%` }} />
      )}
    </div>
  );
}

function FailureLine({ label, value, tone }: { label: string; value: number | null; tone: string }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="typo-body">{label}</span>
        <span className="typo-data tabular-nums">{value == null ? '–' : `${value}%`}</span>
      </div>
      <Bar value={(value ?? 0) / 100} tone={tone} />
    </div>
  );
}
