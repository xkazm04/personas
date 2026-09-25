import type { CuratorProcess } from '@/lib/bindings/CuratorProcess';
import { buildSpine, type SpineModel, type Station } from './engine/spine';
import { DEV_GOOD, DEV_OUTCOMES, devFailure, devInstances, type DevMode } from './engine/devAdapter';
import { OUTCOME_TONE, outcomeName, pct, stationName, type ProcessStrings } from './labels';

/**
 * A lane: one process (one CX) measured by the Spine, carried with everything a side-by-side
 * view needs to draw it without knowing its vocabulary - its station names, its good outcome,
 * its outcome mix. Dev modes are lanes here; the shot harness adds hiring and loop lanes.
 */
export interface LaneOutcome {
  key: string;
  label: string;
  n: number;
  /** Background class for the outcome's swatch. */
  tone: string;
}

export type LaneProvenance = 'real' | 'projected' | 'sample';

export interface ProcessLane {
  id: string;
  title: string;
  /** Plural noun for one instance of this process: sessions, journeys, lanes. */
  unit: string;
  provenance: LaneProvenance;
  model: SpineModel;
  stationName: (keys: string[]) => string;
  good: { label: string; n: number };
  outcomes: LaneOutcome[];
}

// TODO(prototype, 2026-09-24): these move to companions.process.* on consolidation.
export const PROTO = {
  heading: 'Processes side by side',
  subtitle: '{count} processes, each measured on its own derived path',
  sessions: 'sessions',
  reached: 'reached',
  failed: 'failed here',
  failed_short: 'failed',
  stumbled: 'stumbled',
  most_failures: 'Most failures',
  none: 'No failures on the path',
  clean: 'no failures',
  key_reached: 'reached the step',
  key_failed: 'ended there, failed',
  key_stumbled: 'hit an error or a hold there',
  provenance: { real: 'Real', projected: 'Projected', sample: 'Sample' } as Record<LaneProvenance, string>,
  variants: {
    baseline: ['Baseline', 'one process, full height'],
    rivers: ['Rivers', 'a tapering stream per process'],
    transit: ['Transit', 'one line per process, stops left to right'],
    instruments: ['Instruments', 'funnel cards with the failure callout'],
  },
};

/** The figures every variant draws for one station, computed once. */
export interface StationFigures {
  reachedPct: number;
  /** Failed endings filed here, as a share of those who reached it; null when nobody did. */
  exitPct: number | null;
  stumblePct: number | null;
  /** 1-based rank among the stations with the most failures, when in the top three. */
  rank: number | null;
}

export function figures(lane: ProcessLane, s: Station): StationFigures {
  const i = lane.model.worst.indexOf(s.index);
  return {
    reachedPct: pct(s.reached, lane.model.n),
    exitPct: s.reached ? pct(s.exits, s.reached) : null,
    stumblePct: s.reached ? pct(s.friction, s.reached) : null,
    rank: i >= 0 && i < 3 ? i + 1 : null,
  };
}

const MODES: DevMode[] = ['interactive', 'headless'];

/** The two development processes of a reading, as lanes. */
export function devLanes(reading: CuratorProcess, p: ProcessStrings): ProcessLane[] {
  const all = devInstances(reading);
  return MODES.map((mode) => {
    const list = all.filter((x) => x.mode === mode);
    const model = buildSpine(list, devFailure);
    return {
      id: `dev-${mode}`,
      title: mode === 'interactive' ? p.mode_interactive : p.mode_headless,
      unit: PROTO.sessions,
      provenance: 'real' as const,
      model,
      stationName: (keys: string[]) => stationName(p, keys),
      good: { label: p.stat_landed, n: model.outcomes[DEV_GOOD] ?? 0 },
      outcomes: DEV_OUTCOMES.map((o) => ({ key: o, label: outcomeName(p, o), n: model.outcomes[o] ?? 0, tone: OUTCOME_TONE[o] })),
    };
  }).filter((l) => l.model.n > 0);
}

/** Lanes a harness adds beside the dev lanes (hiring, loop runs); the app has none yet. */
let extra: ProcessLane[] = [];
export function primeExtraLanes(lanes: ProcessLane[]): void {
  extra = lanes;
}
export const extraLanes = (): ProcessLane[] => extra;
