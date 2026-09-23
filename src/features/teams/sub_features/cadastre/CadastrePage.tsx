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
import { useCallback, useMemo, useRef, type RefObject } from 'react';

import type { TDevTools } from '@/features/plugins/dev-tools/sub_context/contextLedgerShared';
import type { Translations } from '@/i18n/en';
import type { FeatureBoard } from '@/lib/bindings/FeatureBoard';
import type { UpsertScenarioInput } from '@/lib/bindings/UpsertScenarioInput';

import type { FeatureRow } from '../featureRules';
import type { FeaturesModel } from '../featuresModel';
import { IS_DEV } from '../fixture/featuresFixture';
import { claimedShare, countCats, type CadFilter, type ParcelCat } from './cadastreModel';
import { CadastreMap } from './CadastreMap';
import { CadastreHeader } from './CadastreHeader';
import { runDeedTransition } from './deedTransition';
import { Register } from './Register';
import { MapKey } from './MapKey';
import { ParcelTip } from './ParcelTip';
import { rowDomId } from './RegisterRow';
import { useCadastre } from './useCadastre';
import { useCadastreKeys } from './useCadastreKeys';
import { useMapTip } from './useMapTip';
import './cadastre.css';

export interface CadastrePageProps {
  board: FeatureBoard;
  model: FeaturesModel;
  /** True while the checked-in fixture is on: every write is refused. */
  fixture: boolean;
  /** `/` lands here, exactly as it does on the Board. */
  filterRef: RefObject<HTMLInputElement | null>;
  onOpenContext: () => void;
  onOpenDecision: (subjectId: string) => void;
  onRunCouncil: (row: FeatureRow) => void;
  onToggleTier: (row: FeatureRow) => Promise<void>;
  onUpsertScenario: (input: UpsertScenarioInput) => Promise<void>;
  onDeleteScenario: (id: string) => Promise<void>;
  t: Translations['features'];
  tDev: TDevTools;
  tCommon: { save: string; cancel: string; delete: string };
  tx: (template: string, vars: Record<string, string | number>) => string;
  language: string;
}

const FILTER_CAT: Record<CadFilter, ParcelCat> = { waiting: 'gate', trouble: 'trouble', unclaimed: 'open' };

export function CadastrePage(props: CadastrePageProps) {
  const { model, t, tDev, tx, language, filterRef } = props;
  const cad = useCadastre(model, language);
  const listRef = useRef<HTMLDivElement>(null);
  const layerRef = useRef<HTMLElement>(null);

  const share = useMemo(() => claimedShare(cad.cats), [cad.cats]);
  const waiting = cad.ranked.filter((r) => r.row.move === 'waiting').length;
  const trouble = cad.ranked.filter((r) => r.row.move === 'trouble').length;

  const openDeed = useCallback((key: string, from?: HTMLElement | null) => {
    if (!cad.byKey.has(key)) return;
    const update = () => { cad.focusRow(key); cad.setSel(key); };
    if (cad.open) { update(); return; }
    const src = from ?? document.getElementById(rowDomId(key));
    runDeedTransition(update, src, () => layerRef.current, 'in');
  }, [cad]);

  const closeLayer = useCallback(() => {
    if (!cad.open) return;
    const key = cad.sel;
    runDeedTransition(() => cad.setSel(null), layerRef.current, () => (key ? document.getElementById(rowDomId(key)) : null), 'out');
    listRef.current?.focus({ preventScroll: true });
  }, [cad]);

  useCadastreKeys(
    cad,
    { openDeed, closeLayer, runAction: () => {}, toggleTier: () => {}, openUnclaimed: props.onOpenContext },
    { filter: filterRef, list: listRef },
    { enabled: true, rehearsal: IS_DEV },
  );

  const tip = useMapTip(cad, openDeed);
  const counts = useMemo(() => countCats(cad.cats), [cad.cats]);

  return (
    <div
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
    >
      <CadastreHeader
        share={share}
        waiting={waiting}
        trouble={trouble}
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
          hotClaims={tip.hotClaims}
          onOpen={openDeed}
          onPreview={(key) => cad.setPreview(key ?? cad.focus)}
          unclaimedList={null}
          unclaimedCount=""
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
      <section ref={layerRef} className="layer" data-role="cad-layer" hidden={!cad.open} aria-label={t.cadastre_layer_label} />
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

export default CadastrePage;
