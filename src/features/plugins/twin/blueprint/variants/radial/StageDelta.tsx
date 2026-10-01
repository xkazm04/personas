/**
 * What an answer does to the ring in stage mode, drawn in the gap just outside
 * the answered segment's coverage arc. The goal the answer served is a thin arc on
 * its own 0..1 coverage (the section's coverage when no goal is known).
 * - instant: a tick lights at that arc's end (the topic's cell lights its own
 *   tick in the glyph band; see SectionGlyph).
 * - reconciled: the last `coverageGain` of the arc grows in, bright: the
 *   model already carries the new coverage, so the gain ends where it does.
 * One-shots are framer (`pathLength`), a fade only under reduced motion.
 */
import { motion } from 'framer-motion';

import type { BlueprintDelta } from '../../blueprintContract';
import { RING, arcPath, segmentAngles, spokePath } from './radialGeometry';
import { clamp01, type DeltaTarget } from './radialModel';

interface StageDeltaProps {
  delta: BlueprintDelta;
  target: DeltaTarget;
  /** The section's headline coverage, the fallback base when no goal is known. */
  sectionCoverage: number | null;
  cx: number;
  cy: number;
  R: number;
  reduced: boolean;
}

export function StageDelta({ delta, target, sectionCoverage, cx, cy, R, reduced }: StageDeltaProps) {
  const { a0, a1 } = segmentAngles(target.section);
  const span = a1 - a0;
  const base = target.goal ? target.goal.coverage : sectionCoverage;
  // The gap between the coverage ring and the glyph band: the gain's own track.
  const r = ((RING.main1 + RING.band0) / 2) * R;
  // The band fills most of that gap, so the gain reads at every ring size.
  const band = { strokeWidth: Math.max(4, (RING.band0 - RING.main1) * R * 0.75) };
  const scored = delta.phase === 'reconciled' && delta.coverageGain !== null && base !== null;
  const end = a0 + clamp01(base ?? 0) * span;
  const gainFrom = a0 + clamp01((base ?? 0) - (delta.coverageGain ?? 0)) * span;
  const key = `${delta.answeredStepId}:${delta.phase}`;
  const lightPen = !target.topicId || target.section !== 'training';

  return (
    <g className="rd-delta" data-testid="radial-delta" data-phase={delta.phase} data-section={target.section}>
      <path className="rd-goal-track" d={arcPath(cx, cy, r, a0, a1)} style={band} />
      {base !== null && end > a0 && <path className="rd-goal" d={arcPath(cx, cy, r, a0, end)} style={band} />}
      {base === null && <path className="rd-goal-track rd-dash-line" d={arcPath(cx, cy, r, a0, a1)} data-measured="false" />}
      {lightPen && (
        <path className="rd-lit" data-testid="radial-lit" d={spokePath(cx, cy, RING.main0 * R - 3, RING.band0 * R + 2, end)} />
      )}
      {scored && end > gainFrom && (
        <motion.path
          key={key}
          className="rd-gain"
          data-testid="radial-gain-arc"
          d={arcPath(cx, cy, r, gainFrom, end)}
          style={band}
          initial={reduced ? { opacity: 0 } : { pathLength: 0, opacity: 0.4 }}
          animate={reduced ? { opacity: 1 } : { pathLength: 1, opacity: 1 }}
          transition={{ duration: reduced ? 0.25 : 1.1, delay: reduced ? 0 : 0.25, ease: [0.22, 1, 0.36, 1] }}
        />
      )}
    </g>
  );
}

/** The engine is thinking: a slow tick orbiting just outside the coverage ring (CSS loop; absent under reduced motion). */
export function OrbitTick({ cx, cy, R }: { cx: number; cy: number; R: number }) {
  const r = RING.main1 * R + Math.max(4, R * 0.03);
  return (
    <g className="rd-orbit" data-loop="orbit" style={{ transformOrigin: `${cx}px ${cy}px` }}>
      <path className="rd-orbit-tail" d={arcPath(cx, cy, r, -28, 0)} />
      <circle className="rd-orbit-dot" cx={cx} cy={cy - r} r={Math.max(2.5, R * 0.022)} />
    </g>
  );
}
