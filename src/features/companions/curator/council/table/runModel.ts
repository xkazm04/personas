// The run, turned into the five seats the round table draws.
//
// Everything on this page reads a `Seat`; nothing reads a `CouncilVerdict`
// directly. That is deliberate: a member the rubric names but the run never
// reached has no verdict row at all, and it must still occupy its wedge -
// hatched at full reach, contributing nothing - because absence of a
// measurement is not a low score. A model that only iterated the rows would
// draw a four-wedge rose for a five-member rubric and nobody would notice.
import type { CouncilRun } from '@/lib/bindings/CouncilRun';
import type { CouncilVerdict } from '@/lib/bindings/CouncilVerdict';

import { resolveRubric, type Rubric, type RubricDimension } from './rubrics';

export type SeatState = 'measured' | 'carried' | 'unmeasured' | 'not_applicable' | 'not_run';

export interface Finding {
  id: string;
  severity: 'low' | 'med' | 'high';
  title: string;
  detail: string;
  recurrence: number;
}

export interface EvidenceItem {
  kind: 'file' | 'url' | 'screenshot' | 'video' | 'metric';
  ref: string;
  caption: string;
}

export interface TechniqueProof {
  subject: string;
  technique: string;
  proof: 'execution' | 'inspection' | 'claim';
}

/** One council member as the table draws it. */
export interface Seat {
  /** The rubric dimension name. Seat order is rubric order, never row order. */
  name: string;
  weight: number;
  floor: number | null;
  kind: string;
  threshold: number;
  state: SeatState;
  /** Null is NOT MEASURED. It is never coerced to 0 anywhere on this page. */
  score: number | null;
  confidence: string | null;
  floorHit: boolean;
  advisory: boolean;
  findings: Finding[];
  evidence: EvidenceItem[];
  techniques: TechniqueProof[];
  delta: string | null;
}

const SEVERITIES = new Set(['low', 'med', 'high']);
const EVIDENCE_KINDS = new Set(['file', 'url', 'screenshot', 'video', 'metric']);
const PROOFS = new Set(['execution', 'inspection', 'claim']);

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

/**
 * The member's document half of a verdict row.
 *
 * The invariant that makes the narrowing below safe: `payload_json` is
 * written by the Rust ingest door, which validated it against the frozen
 * result.json schema before any row was inserted - but it is still a BLOB
 * from a file the app did not author, so every field is re-checked here and
 * a shape that does not fit degrades to empty rather than to a cast.
 */
export function parsePayload(payloadJson: string): {
  findings: Finding[];
  evidence: EvidenceItem[];
  techniques: TechniqueProof[];
  delta: string | null;
} {
  let root: Record<string, unknown> | null;
  try {
    root = asRecord(JSON.parse(payloadJson) as unknown);
  } catch {
    // A payload that will not parse is an empty member, never a fabricated
    // one (census `fabricated-json-on-parse-failure`).
    root = null;
  }
  if (!root) return { findings: [], evidence: [], techniques: [], delta: null };

  const findings: Finding[] = [];
  asArray(root.findings).forEach((raw, i) => {
    const f = asRecord(raw);
    if (!f) return;
    const severity = str(f.severity, 'low');
    findings.push({
      id: str(f.id, `f${i}`),
      severity: SEVERITIES.has(severity) ? (severity as Finding['severity']) : 'low',
      title: str(f.title),
      detail: str(f.detail),
      recurrence: typeof f.recurrence === 'number' && Number.isFinite(f.recurrence) ? f.recurrence : 0,
    });
  });

  const evidence: EvidenceItem[] = [];
  asArray(root.evidence).forEach((raw) => {
    const e = asRecord(raw);
    if (!e) return;
    const kind = str(e.kind);
    if (!EVIDENCE_KINDS.has(kind)) return;
    evidence.push({ kind: kind as EvidenceItem['kind'], ref: str(e.ref), caption: str(e.caption) });
  });

  const techniques: TechniqueProof[] = [];
  asArray(root.techniques).forEach((raw) => {
    const tq = asRecord(raw);
    if (!tq) return;
    const proof = str(tq.proof);
    techniques.push({
      subject: str(tq.subject),
      technique: str(tq.technique),
      proof: PROOFS.has(proof) ? (proof as TechniqueProof['proof']) : 'claim',
    });
  });

  return {
    findings,
    evidence,
    techniques,
    delta: typeof root.delta === 'string' && root.delta.length > 0 ? root.delta : null,
  };
}

function seatFromRubric(name: string, def: RubricDimension, rubric: Rubric): Seat {
  return {
    name,
    weight: def.weight,
    floor: def.floor,
    kind: def.kind,
    threshold: rubric.threshold,
    state: 'not_run',
    score: null,
    confidence: null,
    floorHit: false,
    // A member that never ran has no authority to sink anything.
    advisory: def.kind !== 'mechanical',
    findings: [],
    evidence: [],
    techniques: [],
    delta: null,
  };
}

/** Every seat the rubric names, in rubric order, whether the run reached it or not. */
export function seatsOf(
  run: Pick<CouncilRun, 'rubricVersion'> | null,
  subjectKind: string | null,
  verdicts: CouncilVerdict[],
): Seat[] {
  const { rubric } = resolveRubric(run?.rubricVersion ?? null, subjectKind);
  const byDimension = new Map(verdicts.map((v) => [v.dimension, v]));
  const seats = Object.entries(rubric.dimensions).map(([name, def]) => {
    const seat = seatFromRubric(name, def, rubric);
    const v = byDimension.get(name);
    if (!v) return seat;
    const payload = parsePayload(v.payloadJson);
    const state = v.state;
    return {
      ...seat,
      kind: v.kind,
      // The run's own floor wins: it is what was actually applied.
      floor: v.floor ?? def.floor,
      state: (['measured', 'carried', 'unmeasured', 'not_applicable'].includes(state)
        ? state
        : 'unmeasured') as SeatState,
      score: v.score,
      confidence: v.confidence,
      floorHit: v.floorHit,
      advisory: v.advisory,
      ...payload,
    };
  });
  // A dimension the run measured that this rubric does not name still has to
  // be shown - dropping it would hide a measurement.
  for (const v of verdicts) {
    if (rubric.dimensions[v.dimension]) continue;
    const payload = parsePayload(v.payloadJson);
    seats.push({
      name: v.dimension,
      weight: 0,
      floor: v.floor,
      kind: v.kind,
      threshold: rubric.threshold,
      state: 'unmeasured',
      score: v.score,
      confidence: v.confidence,
      floorHit: v.floorHit,
      advisory: v.advisory,
      ...payload,
    });
  }
  return seats;
}

const SEVERITY_RANK: Record<string, number> = { high: 3, med: 2, low: 1 };

/** The one finding worth reading first: severest, on the weakest member, seen most often. */
export function weakestFinding(seats: Seat[]): { seat: Seat; finding: Finding } | null {
  let best: { seat: Seat; finding: Finding; rank: number } | null = null;
  for (const seat of seats) {
    for (const finding of seat.findings) {
      const rank =
        (SEVERITY_RANK[finding.severity] ?? 0) * 10 - (seat.score ?? 0) * 5 + finding.recurrence;
      if (!best || rank > best.rank) best = { seat, finding, rank };
    }
  }
  return best ? { seat: best.seat, finding: best.finding } : null;
}
