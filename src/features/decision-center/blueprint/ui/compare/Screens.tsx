import { memo, useMemo } from 'react';
import type { Comparison, ShotPair } from '@/lib/lensScan/compare';
import { useSheet } from '../../controller/SheetContext';
import type { BpText } from '../../controller/useBlueprintText';
import { Callout, Seg } from '../../ledger/Controls';
import type { CompareTheme, CompareView } from '../../ledger/ledgerStore';
import { pixFacts } from '../../model/ledgerPixels';
import { fmtNum } from '../format';
import { Blink, MapView, pctOf, Slider } from './ScreenModes';
import { NoCapture, ShotFigure, UrlImg } from './ShotFrame';
import { useChangeMap, type MapState, type PairRef } from './useChangeMap';
import { useShotUrls, type ShotState } from './useShotUrl';

/** The pairs a theme choice shows: that theme's, every pair for `both`, and every pair when none has the theme. */
export function shownPairs(pairs: readonly ShotPair[], theme: CompareTheme): ShotPair[] {
  const pick = pairs.filter((s) => theme === 'both' || s.theme === theme);
  return pick.length ? pick : [...pairs];
}

const themeWord = (B: BpText, t: string | undefined): string => (t === 'light' ? B.cmp_theme_light : t === 'dark' ? B.cmp_theme_dark : t ?? B.cmp_screen);

/** The pixel verdict in words over every shown pair (bp PixLine); "comparing" until each is computed, never a guess. */
function PixLine({ show, maps, state }: { show: readonly ShotPair[]; maps: readonly (MapState | undefined)[]; state: string }) {
  const { B, tx, language } = useSheet().text;
  if (show.some((s) => !s.before || !s.after)) return <Callout tone="note"><span aria-hidden="true">?</span><span><b>{B.lg_pix_lone_title}</b> {B.lg_pix_lone}</span></Callout>;
  const err = maps.find((m) => m?.status === 'error');
  if (err?.status === 'error') return <Callout tone="error"><b>{B.lg_pix_error_title}</b> {err.error}</Callout>;
  if (!maps.every((m) => m?.status === 'done')) return <Callout tone="note"><span aria-hidden="true">…</span><span>{B.lg_cmp_comparing}</span></Callout>;
  const facts = show.map((s, i) => { const m = maps[i]; return m?.status === 'done' ? { theme: themeWord(B, s.theme), f: pixFacts(m.grid) } : null; }).filter((x) => x !== null);
  const same = facts.every((x) => x.f.same);
  const text = facts.map(({ theme, f }) => theme + ': ' + (f.kind === 'identical' ? tx(B.lg_pix_identical, { maxd: f.maxd })
    : f.kind === 'near' ? tx(B.lg_pix_near, { moved: pctOf(language, f.moved), maxd: f.maxd })
      : tx(B.lg_pix_differ, { pct: pctOf(language, f.pct), maxd: f.maxd }) + (f.box ? ' ' + tx(B.lg_pix_at, { x0: fmtNum(language, f.box[0]), x1: fmtNum(language, f.box[2]), y0: fmtNum(language, f.box[1]), y1: fmtNum(language, f.box[3]) }) : ''))).join(' ');
  return (
    <Callout tone={same ? 'note' : 'diff'} testId="blueprint-pixline">
      <span aria-hidden="true">{same ? '＝' : '≠'}</span>
      <span><b>{same ? B.lg_pix_same_title : B.lg_pix_diff_title}</b> {text}{same ? ' ' + tx(B.lg_pix_same_tail, { state }) : null}</span>
    </Callout>
  );
}

function Pair({ s, mode, urls, map }: { s: ShotPair; mode: CompareView['mode']; urls: ReadonlyMap<string, Exclude<ShotState, null>>; map: MapState | undefined }) {
  const { B, tx } = useSheet().text;
  const theme = themeWord(B, s.theme), b = s.before ? urls.get(s.before.path) : undefined, a = s.after ? urls.get(s.after.path) : undefined;
  const min = (shot: ShotPair['before']) => { const v = shot?.report?.minTextPx; return tx(B.lg_cmp_min_text, { px: typeof v === 'number' ? v : '–' }); };
  if (mode === 'side' || !s.before || !s.after) {
    return (
      <div className="tr-pair">
        <ShotFigure cap={tx(B.cmp_shot_before, { theme })} aside={min(s.before)}>{s.before ? <UrlImg got={b} alt={tx(B.cmp_shot_before, { theme })} /> : <NoCapture />}</ShotFigure>
        <ShotFigure cap={tx(B.cmp_shot_after, { theme })} aside={min(s.after)}>{s.after ? <UrlImg got={a} alt={tx(B.cmp_shot_after, { theme })} /> : <NoCapture />}</ShotFigure>
      </div>
    );
  }
  if (mode === 'slider') return <div className="tr-pair one"><Slider theme={theme} before={b} after={a} /></div>;
  if (mode === 'blink') return <div className="tr-pair one"><Blink theme={theme} before={b} after={a} /></div>;
  return <div className="tr-pair one"><MapView theme={theme} after={a} map={map} /></div>;
}

/**
 * The compare panel's screens (bp Screens): the item's before/after pairs (compare.ts compareOf, paired by theme and
 * size) in light, dark or both, side by side, as a slider, blinking or as a change map, with the pixel verdict in words
 * over them. Only the shown pairs ask for their images; each pair's change map is computed once per session.
 */
export const Screens = memo(function Screens({ c, view, onView, fname, stateLine }: { c: Comparison; view: CompareView; onView(v: CompareView): void; fname: string; stateLine: string }) {
  const s = useSheet();
  const { B, tx } = s.text;
  const product = s.data.product.projectId;
  const show = useMemo(() => shownPairs(c.shots, view.theme), [c.shots, view.theme]);
  const urls = useShotUrls(useMemo(() => show.flatMap((p) => [p.before?.path, p.after?.path]).filter((x): x is string => !!x), [show]));
  const refs = useMemo(() => show.flatMap((p): PairRef[] => {
    const b = p.before ? urls.get(p.before.path) : undefined, a = p.after ? urls.get(p.after.path) : undefined;
    return p.before && p.after && b && a && 'url' in b && 'url' in a ? [{ key: `${product}:${p.before.id}:${p.after.id}`, before: b.url, after: a.url }] : [];
  }), [show, urls, product]);
  const maps = useChangeMap(refs);
  const mapOf = (p: ShotPair): MapState | undefined => { const i = refs.findIndex((r) => r.key === `${product}:${p.before?.id}:${p.after?.id}`); return i < 0 ? undefined : maps[i]; };
  return (
    <section className="tr-sec" data-testid="blueprint-screens">
      <h4>{B.cmp_screens}
        {c.shots.length ? (
          <span className="r">
            <Seg label={B.cmp_theme_group} value={view.theme} onChange={(theme) => onView({ ...view, theme })} options={[{ value: 'light', label: B.cmp_theme_light }, { value: 'dark', label: B.cmp_theme_dark }, { value: 'both', label: B.cmp_theme_both }]} />
            <Seg label={B.cmp_mode_group} value={view.mode} onChange={(mode) => onView({ ...view, mode })} options={[{ value: 'side', label: B.cmp_mode_side }, { value: 'slider', label: B.cmp_mode_slider }, { value: 'blink', label: B.lg_cmp_mode_blink }, { value: 'map', label: B.lg_cmp_mode_map }]} />
          </span>
        ) : null}
      </h4>
      {!c.shots.length ? <Callout tone="empty"><b>{B.lg_cmp_no_screens_title}</b> {tx(B.lg_cmp_no_screens, { name: fname })}</Callout> : (
        <>
          <PixLine show={show} maps={show.map(mapOf)} state={stateLine} />
          <div className="tr-pairs">{show.map((p) => <Pair key={(p.theme ?? '') + '|' + (p.size ?? '')} s={p} mode={view.mode} urls={urls} map={mapOf(p)} />)}</div>
        </>
      )}
    </section>
  );
});
