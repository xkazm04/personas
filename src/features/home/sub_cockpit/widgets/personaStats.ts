/**
 * personaStats: helpers for derived persona display values (model tier,
 * trust, attention). Pure and framework-free; words and money are formatted
 * by the caller in the active language.
 */
import type { Persona } from '@/lib/bindings/Persona';
import type { PersonaTrustLevel } from '@/lib/bindings/PersonaTrustLevel';

export type ModelTierKey = 'opus' | 'sonnet' | 'haiku' | 'unknown';

/**
 * Best-effort parse of `persona.model_profile`. The field is a free-form
 * string that conventionally contains the model id ("claude-opus-4-7",
 * "claude-sonnet-5-5", etc.). When the value is missing or unrecognized
 * we return `unknown` so callers can show a neutral fallback.
 */
export function modelTierKey(profile: string | null | undefined): ModelTierKey {
  if (!profile) return 'unknown';
  const s = profile.toLowerCase();
  if (s.includes('opus')) return 'opus';
  if (s.includes('sonnet')) return 'sonnet';
  if (s.includes('haiku')) return 'haiku';
  return 'unknown';
}

export function modelTierLabel(profile: string | null | undefined): string {
  switch (modelTierKey(profile)) {
    case 'opus':
      return 'Opus';
    case 'sonnet':
      return 'Sonnet';
    case 'haiku':
      return 'Haiku';
    default:
      // No tier to name: the caller drops the part rather than print a guess.
      return '';
  }
}

/**
 * Trust-display tone. Blends the categorical `trust_level` with the
 * numeric `trust_score` (0–1) so a verified-but-low-score persona reads
 * as a warning rather than green.
 */
export type TrustTone = 'good' | 'warn' | 'bad';

export function trustToneFor(level: PersonaTrustLevel, score: number): TrustTone {
  if (level === 'revoked' || score < 0.5) return 'bad';
  if (level === 'verified' && score >= 0.75) return 'good';
  if (score < 0.7) return 'warn';
  return 'good';
}

/**
 * "Recently active" — used to decide whether to paint a halo on the
 * Constellation node or a small status badge on Roster/Atelier rows.
 * Threshold is 7 days; tunable. `updated_at` is the proxy signal we
 * have without doing an executions lookup.
 */
export function recentActivity(updatedAt: string): boolean {
  const t = Date.parse(updatedAt);
  if (Number.isNaN(t)) return false;
  const days = (Date.now() - t) / (1000 * 60 * 60 * 24);
  return days <= 7;
}

/**
 * Trust-score → display percentage, guarded against double-scaling.
 *
 * `persona.trust_score` is a **0–1 ratio**, and the KPI renders it as
 * `Math.round(score * 100)%`. A stale or Athena-composed spec (or a legacy
 * DB row) that stored the score already-scaled as a percent — e.g. `83.11`
 * instead of `0.8311` — then double-scaled to a nonsense "8311%". Fix at
 * render time so old stored specs display sanely without touching the data:
 *
 * - `score <= 1` → genuine ratio → `score * 100`.
 * - `score > 1`  → already a percent (the double-scale signature) → use as-is
 *   instead of multiplying again.
 * - The result is clamped to `[0, 100]`. `overflow` is set when the
 *   interpreted percentage still exceeds 100 (i.e. the source value was
 *   truly out of range), so the caller can show an explicit "clamped"
 *   treatment + tooltip rather than a silently wrong number.
 *
 * Non-finite / negative inputs floor to 0.
 */
export interface TrustPercent {
  /** Rounded, clamped percentage in [0, 100] — ready to render as `${pct}%`. */
  pct: number;
  /** True when the source value exceeded 100% after ratio interpretation. */
  overflow: boolean;
}

export function trustPercent(score: number): TrustPercent {
  if (!Number.isFinite(score) || score <= 0) return { pct: 0, overflow: false };
  const asPercent = score <= 1 ? score * 100 : score;
  return { pct: Math.round(Math.min(100, asPercent)), overflow: asPercent > 100 };
}

/**
 * Persona "needs attention" reasons. Used by all variants to flag
 * personas that should pop visually before the user even hovers.
 * `label` is a non-displayed fallback kept for this signature's callers (the
 * triggers studio reads only null / not null); surfaces show the localized
 * reason keyed by `kind`.
 */
export interface AttentionFlag {
  kind: 'setup' | 'disabled' | 'low_trust';
  label: string;
  tone: 'warn' | 'bad';
}

export function attentionFor(p: Persona): AttentionFlag | null {
  if (p.setup_status === 'needs_credentials') {
    return { kind: 'setup', label: 'Setup required', tone: 'warn' };
  }
  if (p.enabled === false) {
    return { kind: 'disabled', label: 'Paused', tone: 'warn' };
  }
  if (p.trust_score < 0.5) {
    return { kind: 'low_trust', label: 'Low trust', tone: 'bad' };
  }
  return null;
}
