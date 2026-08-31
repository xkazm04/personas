import type { PersonaCore } from '@/lib/bindings/PersonaCore';

/** The 9-archetype conflict-style vocabulary (`scripts/templates/_archetypes.json`). */
export const CONFLICT_STYLES = ['challenger', 'harmonizer', 'analyst', 'pragmatist'] as const;
export type ConflictStyle = (typeof CONFLICT_STYLES)[number];

/** A blank Core for first authoring — mid dials, harmonizer default. */
export function emptyCore(): PersonaCore {
  return {
    motivation: '',
    stance: '',
    northStarCommitment: '',
    riskTolerance: 0.5,
    speedVsQuality: 0.5,
    conflictStyle: 'harmonizer',
    deference: 0.5,
    identity: undefined,
    voice: undefined,
    principles: [],
    constraints: [],
    decisionPrinciples: [],
  };
}

const clamp01 = (n: unknown, fallback: number): number =>
  typeof n === 'number' && Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : fallback;

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

const strArr = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

/**
 * Tolerant parse of the `personas.core_profile` JSON column. Returns `null`
 * for a missing/blank/corrupt blob so the Core surface can show its
 * authoring empty state instead of exploding on legacy data.
 */
export function parseCoreProfile(json: string | null | undefined): PersonaCore | null {
  if (!json || !json.trim()) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  // Field-by-field narrowing (defaults per the PersonaCore contract) — the
  // blob is operator/template data, so every field is individually suspect.
  const o = raw as Record<string, unknown>;
  return {
    motivation: str(o.motivation),
    stance: str(o.stance),
    northStarCommitment: str(o.northStarCommitment),
    riskTolerance: clamp01(o.riskTolerance, 0.5),
    speedVsQuality: clamp01(o.speedVsQuality, 0.5),
    conflictStyle: str(o.conflictStyle) || 'harmonizer',
    deference: clamp01(o.deference, 0.5),
    identity: typeof o.identity === 'string' ? o.identity : undefined,
    voice: typeof o.voice === 'string' ? o.voice : undefined,
    principles: strArr(o.principles),
    constraints: strArr(o.constraints),
    decisionPrinciples: strArr(o.decisionPrinciples),
  };
}

/** Serialize a Core for the `update_persona` wire (omit empty optionals). */
export function serializeCoreProfile(core: PersonaCore): string {
  const out: PersonaCore = {
    ...core,
    identity: core.identity?.trim() ? core.identity : undefined,
    voice: core.voice?.trim() ? core.voice : undefined,
    principles: core.principles.map((s) => s.trim()).filter(Boolean),
    constraints: core.constraints.map((s) => s.trim()).filter(Boolean),
    decisionPrinciples: core.decisionPrinciples.map((s) => s.trim()).filter(Boolean),
  };
  return JSON.stringify(out);
}
