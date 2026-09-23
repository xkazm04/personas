// A deed at full scale, as its own layer over the register and the map
// (owner: "fuse B/1 as nested layer instead of using side drawer"). The bar
// carries the breadcrumb, the deed's place in the register (`n of N`) and the
// keys that step and close it; the left half is the rose, the right half the
// deed: its head, its one action, its reason, its figures, its members, its
// envelope and its slice.
//
// Always mounted and hidden while closed, so the row can grow into it through
// a view transition. Without view transitions it cross-fades in on the
// `gentle` motion rung, and under reduced motion it simply appears.
import { forwardRef, useState, type ReactNode } from 'react';

import type { TDevTools } from '@/features/plugins/dev-tools/sub_context/contextLedgerShared';
import { MOTION_PRESETS } from '@/lib/utils/animation/animationPresets';
import { formatNumeric, formatPercent } from '@/lib/utils/formatters';

import { FEATURE_COVERAGE_FLOOR, FEATURE_THRESHOLD } from '../featureRules';
import { moveLabel, type FeaturesModel, type TFeatures } from '../featuresModel';
import { standingOf, type CadRow, type ParcelCat } from './cadastreModel';
import type { Measure } from './cadastreLayout';
import { DeedFigures } from './DeedFigures';
import { DeedHead, DeedReason } from './DeedHead';
import { DeedMembers } from './DeedMembers';
import { DeedSlice } from './DeedSlice';
import { EnvelopeList } from './EnvelopeList';
import { RoseFigure } from './RoseFigure';

export interface DeedLayerProps {
  r: CadRow | null;
  position: { index: number; count: number };
  fallbackIn: boolean;
  model: FeaturesModel;
  cats: Map<string, ParcelCat>;
  claims: Map<string, CadRow[]>;
  measure: Measure;
  actions: ReactNode;
  onClose: () => void;
  onStep: (d: number) => void;
  t: TFeatures;
  tDev: TDevTools;
  tx: (template: string, vars: Record<string, string | number>) => string;
  language: string;
}

function Caption({ r, dimName, t, tx, language }: { r: CadRow; dimName: (d: string) => string; t: TFeatures; tx: DeedLayerProps['tx']; language: string }) {
  const c = r.row.feature.council;
  const pct = (v: number) => formatPercent(v, { fromRatio: true, precision: 0, language });
  if (!c) return <p className="rose-cap" data-role="cad-rose-cap">{r.row.running ? t.cadastre_cap_running : t.cadastre_cap_never}</p>;
  const verdicts = r.row.feature.verdicts;
  const ms = verdicts.filter((v) => v.state === 'measured').length;
  const hits = verdicts.filter((v) => v.floorHit);
  const lead = <b>{tx(t.cadastre_cap_members, { ms, n: verdicts.length || 5 })}</b>;
  if (c.overall == null) {
    return <p className="rose-cap" data-role="cad-rose-cap">{lead} {tx(t.cadastre_cap_no_overall, { coverage: c.coverage == null ? t.not_measured : pct(c.coverage), floor: pct(FEATURE_COVERAGE_FLOOR) })}</p>;
  }
  const diff = c.overall - FEATURE_THRESHOLD;
  const f2 = (v: number) => formatNumeric(v, 'plain', { language, precision: 2 });
  return (
    <p className="rose-cap" data-role="cad-rose-cap">
      {lead}{' '}
      {hits.length ? tx(t.cadastre_cap_hits, { count: hits.length, names: hits.map((h) => dimName(h.dimension)).join(', ') }) : t.cadastre_cap_no_hit}{' '}
      <b>{tx(diff >= 0 ? t.cadastre_cap_clears : t.cadastre_cap_misses, { overall: f2(c.overall), bar: f2(FEATURE_THRESHOLD), by: f2(Math.abs(diff)) })}</b>
    </p>
  );
}

export const DeedLayer = forwardRef<HTMLElement, DeedLayerProps>(function DeedLayer(p, ref) {
  const { r, t, tDev, tx, language } = p;
  const [hotScn, setHotScn] = useState<number | null>(null);
  const dimName = (d: string) => (({ value: t.cadastre_dim_value, craft: t.cadastre_dim_craft, rivalry: t.cadastre_dim_rivalry, robustness: t.cadastre_dim_robustness, economics: t.cadastre_dim_economics }) as Record<string, string>)[d] ?? d;
  const districts = r ? new Set(r.row.feature.contextIds.map((id) => p.model.cellById.get(id)?.context.groupId ?? '')).size : 0;

  return (
    <section
      ref={ref}
      className={`layer${p.fallbackIn ? ' fallback-in' : ''} ${MOTION_PRESETS.gentle.css}`}
      data-role="cad-layer"
      data-testid="cad-layer"
      hidden={!r}
      aria-label={r ? r.row.feature.name : t.cadastre_layer_label}
    >
      {r ? (
        <>
          <div className="ly-bar">
            <nav className="crumb" data-role="cad-crumb" aria-label={t.cadastre_crumb_label}>
              <button type="button" onClick={p.onClose}>{t.cadastre_register_title}</button>
              <span className="sep" aria-hidden="true">›</span>
              <button type="button" onClick={p.onClose}>{moveLabel(r.row.move, t)}</button>
              <span className="sep" aria-hidden="true">›</span>
              <span className="cur" data-testid="cad-crumb-current">{r.row.feature.name}</span>
            </nav>
            <span className="ly-pos" data-role="cad-layer-position">{p.position.index >= 0 ? tx(t.cadastre_position, { n: p.position.index + 1, count: p.position.count }) : ''}</span>
            <button type="button" className="ctl" aria-label={t.cadastre_prev} onClick={() => p.onStep(-1)}><kbd className="kbd">[</kbd></button>
            <button type="button" className="ctl" aria-label={t.cadastre_next} onClick={() => p.onStep(1)}><kbd className="kbd">]</kbd></button>
            <button type="button" className="ctl" onClick={p.onClose} data-testid="cad-layer-close">{t.cadastre_close}<kbd className="kbd">Esc</kbd></button>
          </div>
          <div className="ly-body" style={{ ['--tone' as string]: `var(--c-${standingOf(r.row.move)})` }}>
            <div className="ly-left">
              <RoseFigure key={r.key} r={r} measure={p.measure} dimName={dimName} hotScn={hotScn} onHotScn={setHotScn} t={t} tx={tx} language={language} />
              <Caption r={r} dimName={dimName} t={t} tx={tx} language={language} />
            </div>
            <div className="ly-right" tabIndex={-1} data-testid="cad-layer-body">
              <DeedHead r={r} districts={districts} t={t} tDev={tDev} tx={tx} />
              {p.actions}
              <DeedReason r={r} t={t} tx={tx} />
              <div className="ly-cols">
                <div className="ly-col">
                  <DeedFigures feature={r.row.feature} t={t} tx={tx} language={language} />
                  <DeedMembers feature={r.row.feature} dimName={dimName} t={t} language={language} />
                  <EnvelopeList feature={r.row.feature} hotScn={hotScn} onHotScn={setHotScn} t={t} tx={tx} language={language} />
                </div>
                <div className="ly-col">
                  <DeedSlice r={r} model={p.model} cats={p.cats} claims={p.claims} measure={p.measure} t={t} tx={tx} />
                </div>
              </div>
            </div>
          </div>
        </>
      ) : null}
    </section>
  );
});
