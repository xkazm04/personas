// THE PLATE - one KPI, whole, at reading size.
//
// Everything a KPI is, said once and said large: where it lives, what it is
// called, the three numbers that frame it drawn as one travelled line, how
// old the reading is, and the module's own one-sentence next move. The whole
// bet of this concept is that there is room for this because there is only
// ever ONE of them on screen - so the longest KPI name in the real estate
// (115 characters) is set in body type and wraps, rather than being truncated
// into a cell as every other surface in the module has to do.
//
// The travelled line is a figure (doctrine 6c): baseline at the left tick,
// target at the right, and the reading as a caret where it actually sits -
// UNCLAMPED, so an overshoot runs past the target tick and a regression runs
// behind the baseline. A labelled list of the same three numbers would lose
// exactly that.
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { useTranslation } from '@/i18n/useTranslation';

import { HATCH_BG } from '../../kpiChartTheme';
import { kpiNextMoveOf, nextMoveText } from '../../estate/kpiNextMove';
import { TRACK_COLOR, cadenceMeta, categoryMeta, kindMeta } from '../../kpiMeta';
import { travelOf, type SpineTick } from './Console.model';

/** Where the caret can go. Past these the line stops carrying information and
 *  starts carrying ink, so the drawing clamps even though the NUMBER does
 *  not - and the number is printed beside it either way. */
const DRAW_MIN = -20;
const DRAW_MAX = 125;

export function ConsolePlate({ tick, now }: { tick: SpineTick; now: number }) {
  const { t, tx } = useTranslation();
  const o = t.kpis.overview;
  const kpi = tick.kpi;
  const travel = travelOf(kpi);
  const tone = TRACK_COLOR[tick.track];
  const kind = kindMeta(kpi.measure_kind);
  const cadence = cadenceMeta(kpi.cadence);
  const category = categoryMeta(kpi.category);

  return (
    <article className="space-y-3" data-testid="kpi-console-plate">
      <p className="typo-caption">
        {`${tick.projectLabel} / ${tick.groupLabel}`}
      </p>

      {/* Normal weight on white, the tint carries the emphasis. */}
      <h3 className="typo-body-lg text-foreground">{kpi.name}</h3>

      <dl className="flex flex-wrap items-baseline gap-x-5 gap-y-1">
        <Fact label={o.current} value={quantity(kpi.current_value, kpi.unit)} tone={tone} lead />
        <Fact label={o.target} value={quantity(kpi.target_value, kpi.unit)} />
        <Fact label={o.baseline} value={quantity(kpi.baseline_value, kpi.unit)} />
        {/* The app's own time primitive, never a hand-formatted age: it
            live-updates on the shared ticker and carries the full stamp in a
            tooltip. `read_never` is the honest fallback a KPI with no reading
            needs, which is exactly why `fallback` exists. */}
        <div className="flex flex-col-reverse">
          <dt className="typo-caption">{o.books_last_read}</dt>
          <dd className="typo-data tabular-nums leading-tight">
            <RelativeTime timestamp={kpi.last_measured_at} fallback={o.read_never} format="elapsed" />
          </dd>
        </div>
      </dl>

      {travel ? (
        <TravelLine pct={travel.pct} tone={tone} />
      ) : (
        <span
          aria-hidden="true"
          className="block h-2 w-full rounded-[2px]"
          style={{ backgroundImage: HATCH_BG }}
        />
      )}

      <p className="typo-body">{nextMoveText(kpiNextMoveOf(kpi, now), t, tx)}</p>

      <ul className="flex flex-wrap items-center gap-x-4 gap-y-1">
        {[
          { Icon: kind.icon, text: kind.label(t) },
          { Icon: cadence.icon, text: cadence.label(t) },
          { Icon: category.icon, text: category.label(t) },
        ].map(({ Icon, text }) => (
          <li key={text} className="flex items-center gap-1.5">
            <Icon aria-hidden className="h-3.5 w-3.5 shrink-0 text-primary" />
            <span className="typo-caption">{text}</span>
          </li>
        ))}
      </ul>
    </article>
  );
}

/** A reading, or NULL - never a 0 standing in for one. `metric-tile.md`: the
 *  component that decides how to render a quantity has to be handed the
 *  absence, or every call site invents a placeholder and 0 is the cheapest. */
function quantity(value: number | null, unit: string): string | null {
  return value == null ? null : `${value}${unit ? ` ${unit}` : ''}`;
}

function Fact({
  label,
  value,
  tone,
  lead,
}: {
  label: string;
  /** Null = nobody has measured this. The tile says so itself. */
  value: string | null;
  tone?: string;
  lead?: boolean;
}) {
  const { t } = useTranslation();
  return (
    // Label first in the DOM so a reader hears "Current, 40 %"; reversed so
    // the eye meets the figure first - the module's own Stat grammar.
    <div className="flex flex-col-reverse">
      <dt className="typo-caption">{label}</dt>
      <dd
        className={`${lead ? 'typo-data-lg' : 'typo-data'} tabular-nums leading-tight`}
        style={lead ? { color: tone } : undefined}
      >
        {value ?? t.kpis.overview.read_never}
      </dd>
    </div>
  );
}

/** Baseline -> target as a line, with the reading where it actually is. */
function TravelLine({ pct, tone }: { pct: number; tone: string }) {
  const at = Math.max(DRAW_MIN, Math.min(DRAW_MAX, pct));
  // 0 % and 100 % of the TRACK are baseline and target; the track is drawn
  // inset so a caret past either end still has somewhere to be.
  const place = (p: number) => `${((p - DRAW_MIN) / (DRAW_MAX - DRAW_MIN)) * 100}%`;
  return (
    <div className="relative h-6 w-full" data-testid="kpi-console-travel">
      <span aria-hidden="true" className="absolute inset-x-0 top-3 h-px bg-primary/20" />
      <span
        aria-hidden="true"
        className="absolute top-2 h-2 w-px bg-primary/40"
        style={{ left: place(0) }}
      />
      <span
        aria-hidden="true"
        className="absolute top-2 h-2 w-px"
        style={{ left: place(100), background: 'var(--status-success)' }}
      />
      <span
        aria-hidden="true"
        className="absolute top-1.5 h-3 w-0.5 rounded-[1px]"
        style={{ left: place(at), background: tone }}
      />
      <span className="absolute top-0 typo-caption tabular-nums" style={{ left: place(at), color: tone }}>
        {`${pct}%`}
      </span>
    </div>
  );
}
