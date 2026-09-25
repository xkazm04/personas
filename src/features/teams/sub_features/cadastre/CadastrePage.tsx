// The Cadastre: the Features page as a land registry. The context map is
// drawn as parcels per district coloured by the claim on each one, the open
// ground is visible as shape, the register on the left is sorted by whose
// move it is, and a deed opens as a full-scale nested layer over the map
// with the weighted-wedge rating figure.
//
// Promotion of the contest winner features-page-r2 A/2 (owner-chosen
// 2026-09-23). The visual contract is the winner's captured style contract
// at `.claude/features-reference/style-contract/` (machine-local); every
// build of this tree is checked against it to zero deviations, and the
// plan is `docs/design/promotions/2026-09-23-council-hud-and-cadastre.md`.
//
// This component owns selection, filter, focus and the keyboard; the parts
// draw. Its root carries the page's state as data attributes so a browser
// drive can assert on what the page holds, not on its pixels.
import { useLayoutEffect, useMemo, useRef, useState } from 'react';

import { IS_DEV } from '../fixture/featuresFixture';
import { makeMeasure } from './cadastreLayout';
import { claimedShare, countCats, type CadFilter, type ParcelCat } from './cadastreModel';
import { CadastreHeader } from './CadastreHeader';
import { CadastreMap } from './CadastreMap';
import { DeedActions } from './DeedActions';
import { DeedLayer } from './DeedLayer';
import type { CadastrePageProps } from './cadastrePageProps';
import { MapKey } from './MapKey';
import { ParcelTip } from './ParcelTip';
import { Register } from './Register';
import { rowDomId } from './RegisterRow';
import { UnclaimedList, unclaimedDomId } from './UnclaimedList';
import { useCadastre } from './useCadastre';
import { useCadastreKeys } from './useCadastreKeys';
import { useDeedActions } from './useDeedActions';
import { useDeedLayer } from './useDeedLayer';
import { useMapTip } from './useMapTip';
import './cadastre.css';
import './cadastre-layer.css';

const FILTER_CAT: Record<CadFilter, ParcelCat> = { waiting: 'gate', trouble: 'trouble', unclaimed: 'open' };

export function CadastrePage(props: CadastrePageProps) {
  const { model, t, tDev, tx, language, filterRef } = props;
  const cad = useCadastre(model, language);
  const rootRef = useRef<HTMLDivElement>(null);
  const [family, setFamily] = useState('sans-serif');
  useLayoutEffect(() => { if (rootRef.current) setFamily(getComputedStyle(rootRef.current).fontFamily); }, []);
  const measure = useMemo(() => makeMeasure(family), [family]);
  const { listRef, layerRef, fallbackIn, openDeed, closeLayer } = useDeedLayer(cad);
  const deed = useDeedActions(model, cad.selected, props);

  const share = useMemo(() => claimedShare(cad.cats), [cad.cats]);
  const counts = useMemo(() => countCats(cad.cats), [cad.cats]);
  const groupName = useMemo(() => new Map(model.plots.map((p) => [p.group.id, p.group.name])), [model.plots]);

  useCadastreKeys(
    cad,
    { openDeed, closeLayer, runAction: deed.runAction, toggleTier: () => deed.setAsk('tier'), openUnclaimed: props.onOpenContext },
    { filter: filterRef, list: listRef },
    { enabled: deed.ask == null, rehearsal: IS_DEV },
  );
  const tip = useMapTip(cad, openDeed);
  const og = cad.filter === 'unclaimed';
  const position = { index: cad.visible.findIndex((r) => r.key === cad.sel), count: cad.visible.length };

  return (
    <div
      ref={rootRef}
      className="cad"
      data-role="cad-page"
      data-testid="features-cadastre"
      data-focus={cad.focus ?? ''}
      data-sel={cad.open ? cad.sel ?? '' : ''}
      data-filter={cad.filter ?? ''}
      data-sort={cad.sort}
      data-lens={cad.lens ? 'on' : 'off'}
      data-rows={cad.visible.length}
      data-tip={tip.hover?.p?.id ?? ''}
      data-hot={cad.hotCtx ?? ''}
      data-ask={deed.ask ?? ''}
      data-last-write={deed.lastWrite}
    >
      <CadastreHeader
        share={share}
        waiting={cad.ranked.filter((r) => r.row.move === 'waiting').length}
        trouble={cad.ranked.filter((r) => r.row.move === 'trouble').length}
        unclaimed={model.unclaimed.length}
        filter={cad.filter}
        onFilter={(f) => { cad.toggleFilter(f); listRef.current?.focus({ preventScroll: true }); }}
        onHover={(f) => cad.setHlCat(f ? FILTER_CAT[f] : null)}
        rehearsal={IS_DEV ? { big: cad.big, real: model.rows.length, onToggle: cad.toggleBig } : null}
        t={t}
        tx={tx}
        language={language}
      />
      <div className="main">
        <Register
          visible={cad.visible}
          total={cad.ranked.length}
          sort={cad.sort}
          onSort={cad.setSort}
          filter={cad.filter}
          onClearFilter={() => cad.filter && cad.toggleFilter(cad.filter)}
          query={cad.query}
          onQuery={cad.setQuery}
          filterRef={filterRef}
          listRef={listRef}
          focus={cad.focus}
          activeDescendant={og ? (cad.ogFocus ? unclaimedDomId(cad.ogFocus) : undefined) : cad.focus ? rowDomId(cad.focus) : undefined}
          hotClaims={tip.hotClaims}
          onOpen={openDeed}
          onPreview={(key) => cad.setPreview(key ?? cad.focus)}
          unclaimedList={og ? (
            <UnclaimedList
              cells={cad.unclaimed}
              groupName={(id) => groupName.get(id) ?? id}
              focus={cad.ogFocus}
              onFocus={(id) => { cad.setOgFocus(id); cad.setHotCtx(id); }}
              onHover={(id) => cad.setHotCtx(id ?? cad.ogFocus)}
              onOpenContext={props.onOpenContext}
              query={cad.query}
              t={t}
              tx={tx}
            />
          ) : null}
          unclaimedCount={tx(t.cadastre_contexts, { count: cad.unclaimed.length })}
          t={t}
          tDev={tDev}
          tx={tx}
          language={language}
        />
        <section className="mapwrap" data-role="cad-mapwrap" aria-label={t.cadastre_map_label}>
          <CadastreMap
            plots={model.plots}
            cats={cad.cats}
            ranked={cad.ranked}
            claims={cad.claims}
            active={cad.active}
            filterCat={cad.filter ? FILTER_CAT[cad.filter] : null}
            hlCat={cad.hlCat}
            hotCtx={cad.hotCtx}
            onHover={tip.onHover}
            onParcel={tip.onParcel}
            lens={cad.lens && !cad.open}
            label={t.cadastre_map_label}
          />
          <MapKey counts={counts} onHover={cad.setHlCat} onFilter={cad.toggleFilter} t={t} tx={tx} />
        </section>
      </div>
      <DeedLayer
        ref={layerRef}
        r={cad.selected}
        position={position}
        fallbackIn={fallbackIn}
        model={model}
        cats={cad.cats}
        claims={cad.claims}
        measure={measure}
        actions={cad.selected ? (
          <DeedActions r={cad.selected} ask={deed.ask} onAsk={deed.setAsk} busy={deed.busy} onMain={deed.runAction} onConfirmPromote={deed.confirmPromote} onConfirmTier={deed.confirmTier} onMap={closeLayer} t={t} tDev={tDev} tx={tx} />
        ) : null}
        onClose={closeLayer}
        onStep={cad.stepDeed}
        t={t}
        tDev={tDev}
        tx={tx}
        language={language}
      />
      <ParcelTip
        hover={cad.open ? null : tip.hover}
        claims={cad.claims}
        onOpen={(key) => { tip.drop(); openDeed(key); }}
        onUnclaimed={() => { tip.drop(); if (cad.filter !== 'unclaimed') cad.toggleFilter('unclaimed'); }}
        onEnter={tip.keep}
        onLeave={() => tip.onHover(null)}
        t={t}
        tDev={tDev}
        tx={tx}
      />
    </div>
  );
}

export type { CadastrePageProps };
export default CadastrePage;
