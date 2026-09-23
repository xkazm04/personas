// The two reads every fused instrument makes: the data (layout, councils,
// the decisions waiting on the person) and where the reader stands. Both
// come from what the classic stage already holds - `councilStore` and the
// engine - so the fused HUD adds no fetch and no second authority.
import { useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';

import { decidable } from '../../councilRules';
import { effectiveSubject } from '../../bench/queueModel';
import { useCouncilStore } from '../../councilStore';
import type { EnginePath, GalaxyEngine } from '../engine/GalaxyEngine';
import { decisionsOf, type Decision } from './fusedModel';

export interface FusedData {
  decisions: Decision[];
  /** Registry slugs a waiting decision lands on. */
  waitingStars: Set<string>;
  /** Laws by slug, with the statement the document prints. */
  laws: Map<string, { statement: string; techniques: string[] }>;
  lawCount: number;
  /** A subject's registry revision; null is not measured. */
  revisions: Map<string, number | null>;
  applications: number;
  techniqueCount: number;
}

export function useFusedData(): FusedData {
  const { layout, galaxy, subjects, fixtureDecisions } = useCouncilStore(
    useShallow((s) => ({ layout: s.layout, galaxy: s.galaxy, subjects: s.subjects, fixtureDecisions: s.fixtureDecisions })),
  );
  return useMemo(() => {
    const waiting = subjects.map((s) => effectiveSubject(s, fixtureDecisions)).filter(decidable);
    const decisions = decisionsOf(layout, waiting);
    const waitingStars = new Set(decisions.flatMap((d) => d.stars.map((s) => s.slug)));
    const laws = new Map<string, { statement: string; techniques: string[] }>();
    const revisions = new Map<string, number | null>();
    for (const d of galaxy?.domains ?? []) {
      for (const l of d.laws) laws.set(l.slug, { statement: l.statement, techniques: l.techniques });
      for (const c of d.categories) for (const sub of c.subjects) revisions.set(sub.slug, sub.revision);
    }
    const applications = (layout?.subjects ?? []).reduce((n, s) => n + s.applications, 0);
    const techniqueCount = (layout?.subjects ?? []).reduce((n, s) => n + s.techniques.length, 0);
    return { decisions, waitingStars, laws, lawCount: laws.size, revisions, applications, techniqueCount };
  }, [layout, galaxy, subjects, fixtureDecisions]);
}

const EMPTY_PATH: EnginePath = { domain: null, category: null, subject: null, technique: null };

/**
 * Where the reader stands, as nodes, read from the ENGINE after it has
 * applied a focus - never during render, when a focus the store just changed
 * has not reached the engine yet (the relay is an effect). Every focus change
 * and every pin makes the engine draw, so its frame callback is the one
 * signal that is never early; the state only changes when the path does.
 */
export function useFusedPath(engine: GalaxyEngine | null): EnginePath {
  const focus = useCouncilStore((s) => s.focus);
  const [path, setPath] = useState<EnginePath>(EMPTY_PATH);
  useEffect(() => {
    if (!engine) return;
    const read = () => {
      const next = useCouncilStore.getState().focus.kind === 'council' ? EMPTY_PATH : engine.getPath();
      setPath((prev) =>
        prev.domain === next.domain && prev.category === next.category && prev.subject === next.subject && prev.technique === next.technique
          ? prev
          : next,
      );
    };
    read();
    return engine.onFrame(read);
  }, [engine, focus]);
  return path;
}
