import { useMemo } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { devFailure } from '../../engine/devAdapter';
import type { ProcessViewProps } from '../types';
import { contours } from './contours';
import { departureCounts, surveyFates, type Fates } from './fates';
import { computeGeo, type Geo } from './geometry';
import { allocLabels, type MapLabels } from './labels';
import { ghostBanks, graticule, midline, rapids, riverPaths, seaPaths } from './paths';
import type { Pt } from './noise';
import type { StageEnv } from './useStageEnv';
import { mapWords, windowText } from './words';

export interface Scene {
  g: Geo;
  fates: Fates;
  labels: MapLabels;
  river: ReturnType<typeof riverPaths>;
  mid: Pt[];
  rapids: ReturnType<typeof rapids>;
  sea: ReturnType<typeof seaPaths>;
  graticule: string;
  relief: { regular: string; index: string };
  ghost: { top: string; bottom: string } | null;
  cartTitle: string;
  cartSub: string;
  /** Sessions leaving into marshes, lakes and the sea: the conservation line. */
  totals: { marsh: number; lake: number; sea: number };
  /** The view's outcomes, whole: a mouth names every session of its outcome, not only those that reached the sea. */
  outcomes: Record<string, number>;
}

/**
 * Everything the Watershed draws, derived once per (view, stage size, type size). Hover, focus and
 * the camera read this and never recompute it.
 */
export function useScene({ reading, mode, repo, cohort, view, model, base }: ProcessViewProps, env: StageEnv | null): Scene | null {
  const { t, tx, language } = useTranslation();
  const p = t.companions.process;
  const w = p.watershed;
  const fates = useMemo(() => surveyFates(view, model, devFailure), [view, model]);
  const baseDeps = useMemo(() => (repo ? departureCounts(surveyFates(cohort, base, devFailure)) : null), [repo, cohort, base]);
  const repos = useMemo(() => new Set(cohort.map((x) => x.project)).size, [cohort]);
  const win = useMemo(() => windowText(reading.sessions.map((s) => s.start), language), [reading, language]);

  const modeName = mode === 'interactive' ? p.mode_interactive : p.mode_headless;
  const cartTitle = repo ? tx(w.cart_title_repo, { repo, mode: modeName }) : tx(w.cart_title, { mode: modeName });
  const cartSub = repo
    ? tx(w.cart_sub_repo, { count: model.n, total: cohort.length, ...win })
    : tx(w.cart_sub, { count: model.n, repos, ...win });
  const scaleProbe = tx(w.scale_conserved, { marsh: '000', lake: '000', sea: '0000' });

  return useMemo(() => {
    if (!env) return null;
    const g = computeGeo({ W: env.W, H: env.H, fs: env.fs, model, fates, seed: mode + (repo ?? ''), picked: !!repo,
      cartTitle, cartSub, scaleProbe, measure: env.measure });
    const labels = allocLabels(g, model, mapWords(p, tx, model), env.measure, !!baseDeps);
    const marsh = g.cFail.reduce((a, b) => a + b, 0), lake = g.cClean.reduce((a, b) => a + b, 0);
    return {
      g, fates, labels,
      river: riverPaths(g),
      mid: midline(g),
      rapids: rapids(g, model),
      sea: seaPaths(g),
      graticule: graticule(g),
      relief: contours(g, mode),
      ghost: baseDeps ? ghostBanks(g, base.n, baseDeps.clean, baseDeps.fail) : null,
      cartTitle, cartSub,
      totals: { marsh, lake, sea: g.n - marsh - lake },
      outcomes: model.outcomes,
    };
  }, [env, model, fates, mode, repo, cartTitle, cartSub, scaleProbe, p, tx, baseDeps, base.n]);
}
