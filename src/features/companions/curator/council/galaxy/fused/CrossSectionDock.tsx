// The wide bottom cross-section (mode `bar`). Folded, it is one line of ticks
// for the whole scope plus the care cells lifted out of it on threads;
// spread, it is one row per altitude with funnels and a preview row under the
// pointer. Its visible height IS the bottom inset the engine is easing, read
// back every frame, so the dock rises and sinks with the field - folding and
// spreading ride the same curve.
import { useEffect, useMemo, useRef } from 'react';

import type { EnginePath, GalaxyEngine } from '../engine/GalaxyEngine';
import type { GalaxyLayout } from '../engine/types';
import { CareCells } from './CareCells';
import { careGroups, orderedSubjects } from './careModel';
import { DockGroove } from './DockGroove';
import { DockHead } from './DockHead';
import { careScope, nodeTitle } from './fusedModel';
import { useFusedStore } from './fusedStore';
import { useFusedStrings } from './fusedStrings';
import { SpreadCanvas } from './SpreadCanvas';
import type { SpreadWords } from './spreadPaint';
import type { InstrumentColors } from './tokenColors';

interface Props {
  engine: GalaxyEngine | null;
  layout: GalaxyLayout;
  path: EnginePath;
  waitingStars: Set<string>;
  lit: Set<string> | null;
  /** The height the dock takes when it is up (folded or spread). */
  target: number;
  narrow: boolean;
  colors: InstrumentColors | null;
}

export function CrossSectionDock({ engine, layout, path, waitingStars, lit, target, narrow, colors }: Props) {
  const s = useFusedStrings();
  const f = s.f;
  const mode = useFusedStore((st) => st.mode);
  const spread = useFusedStore((st) => st.spread);
  const filters = useFusedStore((st) => st.filters);
  const dockRef = useRef<HTMLElement | null>(null);
  const cellsRef = useRef<HTMLDivElement | null>(null);
  const scope = careScope(path);
  const scopeName = scope ? nodeTitle(scope) : f.say_fit_where_sky;
  const all = useMemo(() => orderedSubjects(layout, scope), [layout, scope]);
  const care = useMemo(() => careGroups(layout, scope, waitingStars, filters), [layout, scope, waitingStars, filters]);
  const careSet = useMemo(() => new Set(care.groups.flatMap((g) => g.subjects)), [care]);
  const words: SpreadWords = useMemo(
    () => ({
      tag: (i) => s.tag((['sky', 'domain', 'category', 'subject', 'technique'] as const)[i] ?? 'sky'),
      unit: (i, n) => `${s.n(n)} ${i === 3 ? f.list_each_techniques : f.list_each_subjects}`,
      point: (i) => (i === 1 ? f.spread_point_domain : i === 2 ? f.spread_point_category : f.spread_point_subject),
      rest: (i) => (i === 1 ? f.spread_rest_domain : f.spread_rest),
      everyDomain: f.every_domain,
    }),
    [s, f],
  );

  // What shows of the dock is the bottom inset the flight is easing.
  useEffect(() => {
    if (!engine) return;
    const apply = () => {
      const el = dockRef.current;
      if (!el) return;
      const vis = Math.max(0, engine.getInsets().b);
      const h = Math.max(target, vis);
      el.style.height = `${h.toFixed(1)}px`;
      el.style.transform = `translateY(${(h - vis).toFixed(1)}px)`;
      el.style.visibility = vis < 0.5 ? 'hidden' : '';
    };
    apply();
    return engine.onFrame(apply);
  }, [engine, target]);

  return (
    <section
      ref={dockRef}
      className={`fz-dock${spread ? ' spread' : ''}`}
      aria-label={f.dock_label}
      data-role="hud-dock"
      inert={mode !== 'bar'}
    >
      <DockHead all={all} careCount={care.count} scopeName={scopeName} narrow={narrow} waitingStars={waitingStars} />
      <div className="fz-care-body">
        <DockGroove
          engine={engine}
          subjects={all}
          care={careSet}
          waitingStars={waitingStars}
          bySky={!scope}
          here={path.subject}
          cellsRef={cellsRef}
          colors={colors}
        />
        <CareCells
          engine={engine}
          groups={care.groups}
          all={care.all}
          scopeName={scopeName}
          here={path.subject}
          waitingStars={waitingStars}
          cellsRef={cellsRef}
        />
      </div>
      {spread ? <SpreadCanvas engine={engine} layout={layout} path={path} words={words} waitingStars={waitingStars} lit={lit} colors={colors} /> : null}
    </section>
  );
}

export default CrossSectionDock;
