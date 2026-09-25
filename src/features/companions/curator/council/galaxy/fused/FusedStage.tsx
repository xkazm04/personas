// The fused instrument: the registry galaxy flown with the round-3 contest
// HUD. The field is the product's own engine (`../engine/GalaxyEngine`) in
// its `fused` style profile; over it, an altitude timeline with the nested
// list on the left, the named decisions at the top right, and two heavy
// instruments switched from the keyboard as MODES, never stacked: the
// bezel lens (the registry engraved on a dial rim that re-engraves per
// altitude), the cross-section dock (folded to what needs care at desktop
// width, spread on a wide monitor), or none, the galaxy alone.
//
// Promotion of the contest winner council-hud-r2-r3 (owner-chosen
// 2026-09-23). The visual contract is the winner's captured style contract
// at `.claude/council-reference/style-contract/` (machine-local); every
// build of this tree is checked against it to zero deviations, and the
// plan is `docs/design/promotions/2026-09-23-council-hud-and-cadastre.md`.
//
// It takes `GalaxyStage`'s slot and props, so the page dispatches on the
// variant and nothing else, and the bench keeps its `setBenchHeight` seam.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { useCouncilStore } from '../../councilStore';
import type { GalaxyEngine } from '../engine/GalaxyEngine';
import { useHudReservations } from '../useHudReservations';
import { useRegistryRoot } from '../useRegistryRoot';
import { BezelLens } from './BezelLens';
import { CrossSectionDock } from './CrossSectionDock';
import { DecisionsPanel } from './DecisionsPanel';
import { FieldTip } from './FieldTip';
import { Finder } from './Finder';
import { FusedCanvas } from './FusedCanvas';
import { FusedUnpaired } from './FusedUnpaired';
import { useFusedStore } from './fusedStore';
import { LIST_ID, listKids } from './NestedList';
import { NavColumn } from './NavColumn';
import { SayCaption } from './SayCaption';
import { rowsWanted, spreadHeight } from './spreadPaint';
import { levelOf } from './fusedModel';
import { useFusedData, useFusedPath } from './useFused';
import { useFusedKeys } from './useFusedKeys';
import { TechniqueDocument } from './TechniqueDocument';
import { useInstrumentColors } from './tokenColors';
import { CARE_H, docWidth, useStageFrame, useStageSize } from './useStageFrame';
import './fused.css';

export function FusedStage({ bench }: { bench?: ReactNode }) {
  const registryRoot = useRegistryRoot();
  const [engine, setEngineLocal] = useState<GalaxyEngine | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const navRef = useRef<HTMLElement | null>(null);
  const beaconRef = useRef<HTMLElement | null>(null);
  const cards = useMemo(() => [navRef, beaconRef], []);

  const layout = useCouncilStore((s) => s.layout);
  const fixtureOn = useCouncilStore((s) => s.fixtureOn);
  const hover = useCouncilStore((s) => s.hover);
  const focus = useCouncilStore((s) => s.focus);
  const load = useCouncilStore((s) => s.load);
  const publishEngine = useCouncilStore((s) => s.setEngine);
  const finderOpen = useFusedStore((s) => s.finderOpen);
  const mode = useFusedStore((s) => s.mode);
  const spread = useFusedStore((s) => s.spread);
  const setCursor = useFusedStore((s) => s.setCursor);

  useEffect(() => {
    if (fixtureOn) return;
    void load(registryRoot);
  }, [fixtureOn, load, registryRoot]);

  // This stage owns the engine and is the only thing that publishes it, as
  // `GalaxyStage` does, so the bench can hand the reader's camera back.
  const setEngine = useCallback(
    (next: GalaxyEngine | null) => {
      setEngineLocal(next);
      publishEngine(next);
    },
    [publishEngine],
  );

  const data = useFusedData();
  const nameCount = useMemo(
    () => (layout ? layout.domains.reduce((n, d) => n + 1 + d.categories.length, 0) + layout.subjects.length + data.techniqueCount : 0),
    [layout, data.techniqueCount],
  );
  const path = useFusedPath(engine);
  const size = useStageSize(stageRef);
  const colors = useInstrumentColors(stageRef, Boolean(layout));
  // The dock's height when it is up: the folded strip, or one row per
  // altitude of the descent plus the preview row when it is spread.
  const dockH = spread ? spreadHeight(rowsWanted(path, null).length) : CARE_H;
  useStageFrame({ engine, stageRef, navRef, size, dockH });
  useHudReservations(stageRef, cards, engine, true);
  useFusedKeys(engine, layout, path, data.decisions);

  // The field under the pointer rests on a row of the list, as the list
  // itself does: the child you point at opens in place.
  useEffect(() => {
    if (!layout || !hover) return;
    if (listKids(layout, path).includes(hover)) setCursor(hover);
  }, [hover, layout, path, setCursor]);

  if (!registryRoot && !fixtureOn) return <FusedUnpaired />;
  const lit = focus.kind === 'council' ? new Set(focus.registrySubjects) : null;
  const waitingSubjects = data.decisions.flatMap((d) => d.stars);
  // Over the lens on a narrow stage, below the sky, the panel folds to its count.
  const fold = mode === 'lens' && !path.technique && levelOf(path) >= 1 && size.w < 1400 && focus.kind !== 'council';

  return (
    <div
      ref={stageRef}
      className={`fz${size.w >= 1600 ? ' fz-wide' : ''}${path.technique ? ' doc' : ''}`}
      data-role="hud-page"
      data-testid="council-fused-stage"
    >
      <FusedCanvas describedBy={LIST_ID} onEngine={setEngine} />
      {layout ? (
        <BezelLens
          engine={engine}
          layout={layout}
          path={path}
          colors={colors}
          lit={lit}
          waiting={waitingSubjects}
          stageRef={stageRef}
          beaconRef={beaconRef}
        />
      ) : null}
      <NavColumn engine={engine} path={path} data={data} navRef={navRef} />
      <DecisionsPanel decisions={data.decisions} fold={fold} beaconRef={beaconRef} />
      {layout ? (
        <CrossSectionDock
          engine={engine}
          layout={layout}
          path={path}
          waitingStars={data.waitingStars}
          lit={lit}
          target={dockH}
          narrow={size.w < 1200}
          colors={colors}
        />
      ) : null}
      {layout ? (
        <TechniqueDocument
          engine={engine}
          layout={layout}
          technique={path.technique}
          data={data}
          wide={docWidth(size.w, navRef.current?.offsetWidth ?? 284) >= 700}
        />
      ) : null}
      <FieldTip layout={layout} waitingStars={data.waitingStars} />
      <SayCaption
        stageRef={stageRef}
        where={path.subject?.title ?? path.category?.title ?? path.domain?.title ?? null}
        names={nameCount}
        techniques={data.techniqueCount}
        spreadHeight={spreadHeight(rowsWanted(path, null).length)}
      />
      {finderOpen && layout ? <Finder engine={engine} layout={layout} /> : null}
      {bench}
    </div>
  );
}

export default FusedStage;
