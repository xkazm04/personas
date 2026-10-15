import { useMemo } from 'react';
import type { CuratorProcessSession } from '@/lib/bindings/CuratorProcessSession';
import type { ProcessViewProps } from '../types';
import { rawIndex } from './dialDetail';
import { departuresOf, fatesOf, type Fate } from './dialFate';
import { buildArcs, buildFigures, buildRings, type Figure, type RepoArc, type Ring } from './dialModel';

/** Everything the Dial draws, derived once per (reading, mode, repository) and shared by every part. */
export interface DialData {
  keys: string[][];
  fates: Map<string, Fate>;
  raw: Map<string, CuratorProcessSession>;
  rings: Ring[];
  arcs: RepoArc[];
  figs: Figure[];
}

export function useDialData({ reading, repo, cohort, view, model, base }: ProcessViewProps): DialData {
  // The path is the engine's, taken from the whole mode (a repository is measured against it).
  const keys = useMemo(() => base.stations.map((s) => s.keys), [base]);
  const fates = useMemo(() => fatesOf(cohort, keys), [cohort, keys]);
  const raw = useMemo(() => rawIndex(reading), [reading]);
  const arcs = useMemo(() => buildArcs(cohort), [cohort]);
  const rings = useMemo(() => buildRings(model, base, departuresOf(view, fates, keys.length)), [model, base, view, fates, keys]);
  const figs = useMemo(() => buildFigures(model, base, repo != null), [model, base, repo]);
  return { keys, fates, raw, rings, arcs, figs };
}
