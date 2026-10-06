// THE CONSOLE - "one KPI, and a dial".
//
// The bet: AT 1,044 KPIs YOU DO NOT NEED TO SEE THE ESTATE, YOU NEED ONE OF
// THEM WHOLE AND YOUR HANDS ON THE DIAL THAT WALKS TO THE NEXT. The estate is
// already ranked by what a human could do about it today - that ordering is
// what the kpi-descent contest settled on - and Map, Ledger and River all
// discard it to re-group the same KPIs into a picture. This one keeps it: the
// sequence IS the surface, the first tick is the answer, and the arrow keys
// are the whole interface.
//
// Two things that only this concept can do, both of them consequences of
// there being exactly one KPI on screen at a time:
//
//  * The 115-character KPI name in this estate is set at reading size and
//    wraps. Every other surface in the module has to truncate it into a cell.
//  * The three numbers that frame a reading (baseline, current, target) are
//    drawn as one travelled line with the reading where it actually sits,
//    unclamped, so an overshoot and a regression are each visible.
//
// Keyboard over chrome, and discoverable: the keys are printed under the
// spine rather than left for somebody to find. Nothing is hidden behind a
// hover.
//
// Same data, same actions, same destinations: Enter opens the KPI's detail
// through the dispatcher's own `onOpen`, `g` hands up the same `KpiFocus`
// every other variant hands up, and Escape still climbs.
import { useCallback, useMemo, useState } from 'react';

import { ExternalLink, Layers } from 'lucide-react';

import Button from '@/features/shared/components/buttons/Button';
import { useAppKeyboard, ROUTE_DECISION_PRIORITY } from '@/lib/keyboard/AppKeyboardProvider';
import { isTypingTarget } from '@/lib/keyboard/KeyboardNavMode';
import { useTranslation } from '@/i18n/useTranslation';

import type { KpiVariantProps } from '../KPIDashboard';
import { buildEstate } from '../estate/kpiEstate';
import { buildSpine, jumpSegment, segmentIndexAt, stepCursor } from './console/Console.model';
import { ConsolePlate } from './console/ConsolePlate';
import { ConsoleSegments, ConsoleSpine } from './console/ConsoleSpine';

/** One press of PageUp / PageDown. A quarter of a wrapped row of ticks at
 *  1280px, so a page is a visible distance rather than an arbitrary jump. */
const PAGE = 25;

/** The keys, as the strip prints them. Not translated: they are literal key
 *  names, and a localised arrow glyph would stop matching the keyboard. */
const KEY_HINT = '← →  ·  PgUp PgDn  ·  [ ]  project  ·  Enter  open  ·  g  group  ·  Esc  up';

export default function Console({ overview, loading, onFocus, onOpen }: KpiVariantProps) {
  const { t, tx } = useTranslation();
  const o = t.kpis.overview;
  const estate = useMemo(() => buildEstate(overview), [overview]);
  const spine = useMemo(() => buildSpine(estate), [estate]);
  const [at, setAt] = useState(0);

  // A refetch that shortened the estate must not leave the cursor past the
  // end: the position readout would print a number that is not there.
  const index = Math.min(at, Math.max(0, spine.ticks.length - 1));
  const tick = spine.ticks[index];

  const onKey = useCallback(
    (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      // `g`, `[` and `]` are ordinary characters, so a surface that claims
      // them must never claim them out of a text field. Escape is guarded the
      // same way one rung up, in `useKpiAltitude`.
      if (isTypingTarget(e.target) || document.querySelector('[role="dialog"]')) return;
      const step = (d: number) => { setAt((n) => stepCursor(spine, n, d)); return true; };
      switch (e.key) {
        case 'ArrowRight': return step(1);
        case 'ArrowLeft': return step(-1);
        case 'PageDown': return step(PAGE);
        case 'PageUp': return step(-PAGE);
        case 'Home': return step(-spine.ticks.length);
        case 'End': return step(spine.ticks.length);
        case ']': setAt((n) => jumpSegment(spine, n, 1)); return true;
        case '[': setAt((n) => jumpSegment(spine, n, -1)); return true;
        case 'Enter':
          if (!tick) return;
          onOpen(tick.kpi.id);
          return true;
        case 'g':
          if (!tick) return;
          onFocus({ projectId: tick.projectId, groupId: tick.groupId });
          return true;
        default:
          return;
      }
    },
    [spine, tick, onOpen, onFocus],
  );
  useAppKeyboard(onKey, { priority: ROUTE_DECISION_PRIORITY + 4 });

  if (loading && overview.length === 0) return <ConsoleGhost />;

  return (
    <div className="space-y-4" data-testid="kpi-console">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-primary/10 pb-2">
        <p className="typo-data-lg tabular-nums">
          {tx(o.measured_of, { measured: spine.ticks.length === 0 ? 0 : index + 1, total: spine.ticks.length })}
        </p>
        <p className="typo-caption">{o.books_caption}</p>
      </div>

      {tick ? <ConsolePlate tick={tick} now={estate.now} /> : <p className="typo-body">{o.rail_settled}</p>}

      <ConsoleSpine
        spine={spine}
        at={index}
        onPick={setAt}
        label={tx(o.composition_aria, {
          met: estate.tally.met,
          onTrack: estate.tally.onTrack,
          offTrack: estate.tally.offTrack,
          unpaced: estate.tally.unpaced,
          unmeasured: estate.tally.unmeasured,
          total: estate.tally.total,
        })}
      />

      <ConsoleSegments spine={spine} active={segmentIndexAt(spine, index)} onJump={setAt} />

      {/* Printed, not hidden: a shortcut nobody can discover is not a feature. */}
      <p className="typo-caption">{KEY_HINT}</p>

      {/* The two destinations the keys reach, as real labelled controls - not
          a glyph toolbar hovering over the text. Both of them are the SAME
          doors every other variant uses. */}
      {tick && (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            size="xs"
            icon={<ExternalLink className="h-3.5 w-3.5" />}
            onClick={() => onOpen(tick.kpi.id)}
            data-testid="kpi-console-open"
          >
            {o.layer_col_kpi}
          </Button>
          <Button
            variant="ghost"
            size="xs"
            icon={<Layers className="h-3.5 w-3.5" />}
            onClick={() => onFocus({ projectId: tick.projectId, groupId: tick.groupId })}
            data-testid="kpi-console-group"
          >
            {`${o.books_group} · ${tick.groupLabel}`}
          </Button>
        </div>
      )}
    </div>
  );
}

/** Cold store, read in flight: the real geometry, invisible for its first
 *  ~150 ms so a fast read never flashes (docs/design/overview-loading.md). */
function ConsoleGhost() {
  return (
    <div className="space-y-4" data-testid="kpi-console-ghost" aria-hidden="true">
      {[32, 110, 38].map((h, i) => (
        <span
          key={h}
          className="block rounded-interactive bg-primary/[0.06] animate-fade-in"
          style={{ height: h, animationDelay: `${150 + i * 35}ms` }}
        />
      ))}
    </div>
  );
}
