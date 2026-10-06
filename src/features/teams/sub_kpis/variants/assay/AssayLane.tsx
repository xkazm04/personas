// One lane of the bench: a mechanism, its flume, and the places that own what
// the flume lost.
//
// The lane's header is the only place its SIZE is stated, because the figure
// deliberately spends its height on yield instead (see `AssayFlume`). The
// rail underneath is the lane's one door: a place that is losing KPIs here is
// the place to go, and it is addressed at whichever altitude the surface is
// reading - a project at the portfolio, a group inside a project.
import Button from '@/features/shared/components/buttons/Button';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useTranslation } from '@/i18n/useTranslation';

import { SizeBar } from '../../estate/CoverageBar';
import { kindMeta } from '../../kpiMeta';
import { AssayFlume } from './AssayFlume';
import type { AssayLane as Lane } from './Assay.model';

/** The three stages, in the estate's own words. `books_declared` /
 *  `books_observed` / `debt_verdict` are the ledger's existing nouns for
 *  exactly these three facts, so the bench and the books agree. */
function stageNames(o: { books_declared: string; books_observed: string; debt_verdict: string }): string[] {
  return [o.books_declared, o.books_observed, o.debt_verdict];
}

/** How many places the rail names before it stops. Eleven projects fit; 71
 *  groups do not, and a rail that wraps for six lines stops being a rail. */
const RAIL_CAP = 6;

export function AssayLaneRow({
  lane,
  widest,
  onPress,
}: {
  lane: Lane;
  widest: number;
  onPress: (id: string) => void;
}) {
  const { t, tx } = useTranslation();
  const o = t.kpis.overview;
  const meta = kindMeta(lane.kind);
  const Icon = meta.icon;
  const names = stageNames(o);
  const yieldPct = Math.round(lane.yield * 1000) / 10;
  const shown = lane.stalled.slice(0, RAIL_CAP);
  const rest = lane.stalled.length - shown.length;

  return (
    <li className="space-y-1.5" data-testid={`kpi-assay-lane-${lane.kind}`}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <Icon aria-hidden className="h-3.5 w-3.5 shrink-0 self-center text-primary" />
        <h3 className="typo-submodule-header">{meta.label(t)}</h3>
        <p className="typo-data tabular-nums">
          {tx(o.measured_of, { measured: lane.observed, total: lane.declared })}
        </p>
        {/* The yield is the lane's verdict on itself and the one figure that
            orders the four lanes, so it carries the lane's single emphasis. */}
        <p className="typo-data-lg tabular-nums text-primary">{`${yieldPct}%`}</p>
        <span className="ml-auto w-24 shrink-0 self-center">
          <SizeBar total={lane.declared} max={widest} />
        </span>
      </div>

      <AssayFlume
        lane={lane}
        label={tx(o.composition_aria, {
          met: lane.met,
          onTrack: lane.onTrack,
          offTrack: lane.offTrack,
          unpaced: lane.unjudged,
          unmeasured: lane.dark,
          total: lane.declared,
        })}
      />

      <div className="grid grid-cols-3 gap-x-2">
        {names.map((name, i) => (
          <p key={name} className={`typo-eyebrow ${i === 0 ? '' : 'border-l border-primary/20 pl-2'}`}>
            {name}{' '}
            <span className="tabular-nums">{[lane.declared, lane.observed, lane.verdict][i]}</span>
          </p>
        ))}
      </div>

      {shown.length > 0 && (
        <ul className="flex flex-wrap items-center gap-1">
          {lane.gaps.map((g) => (
            <li key={g.gap} className="typo-caption tabular-nums mr-2">
              {`${g.count} ${o.moves.gaps[g.gap]}`}
            </li>
          ))}
          {shown.map((share) => (
            <li key={share.id}>
              <Tooltip content={tx(o.measured_of, { measured: share.count - share.dark, total: share.count })}>
                <Button
                  variant="ghost"
                  size="xs"
                  className="border border-primary/15"
                  onClick={() => onPress(share.id)}
                  data-testid={`kpi-assay-share-${lane.kind}-${share.id}`}
                >
                  <span className="typo-caption">{share.label}</span>{' '}
                  <span className="typo-caption tabular-nums text-foreground">{share.count}</span>
                </Button>
              </Tooltip>
            </li>
          ))}
          {rest > 0 && (
            <li className="typo-caption tabular-nums">{tx(o.layer_more_title, { count: rest })}</li>
          )}
        </ul>
      )}
    </li>
  );
}
