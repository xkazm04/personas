/**
 * personaStats — shared, prototype-phase helpers for derived display
 * values used by all PersonaOverview variants. Pure, framework-free.
 *
 * Lives next to the variants during prototyping. If a non-winning
 * variant uses values uniquely, that derivation should inline into the
 * variant before Phase 5 consolidation.
 */
import type { Persona } from '@/lib/bindings/Persona';
import type { PersonaTrustLevel } from '@/lib/bindings/PersonaTrustLevel';

export type ModelTierKey = 'opus' | 'sonnet' | 'haiku' | 'unknown';

/**
 * Best-effort parse of `persona.model_profile`. The field is a free-form
 * string that conventionally contains the model id ("claude-opus-4-7",
 * "claude-sonnet-4-6", etc.). When the value is missing or unrecognized
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
      return 'Mixed';
  }
}

/**
 * Accent class bundle for the model tier — used by Constellation nodes
 * + Atelier hero cards. Includes both a hex (for inline SVG strokes)
 * and tailwind class names (for DOM fills/borders).
 */
export interface TierAccent {
  fillClass: string;
  strokeClass: string;
  strokeHoverClass: string;
  textClass: string;
  bgSoftClass: string;
  borderClass: string;
  btnClass: string;
  /** Hex literal for SVG `stroke=` attributes. Approximation of the tailwind class. */
  haloHex: string;
}

export function modelTierAccent(profile: string | null | undefined): TierAccent {
  switch (modelTierKey(profile)) {
    case 'opus':
      return {
        fillClass: 'fill-violet-500/30 stroke-violet-300/80',
        strokeClass: 'stroke-violet-300/80',
        strokeHoverClass: 'stroke-violet-200',
        textClass: 'text-violet-300',
        bgSoftClass: 'bg-violet-500/10',
        borderClass: 'border-violet-500/25',
        btnClass: 'bg-violet-500/15 hover:bg-violet-500/25 text-violet-200 border border-violet-500/30',
        haloHex: '#c4b5fd',
      };
    case 'sonnet':
      return {
        fillClass: 'fill-cyan-500/30 stroke-cyan-300/80',
        strokeClass: 'stroke-cyan-300/80',
        strokeHoverClass: 'stroke-cyan-200',
        textClass: 'text-cyan-300',
        bgSoftClass: 'bg-cyan-500/10',
        borderClass: 'border-cyan-500/25',
        btnClass: 'bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-200 border border-cyan-500/30',
        haloHex: '#67e8f9',
      };
    case 'haiku':
      return {
        fillClass: 'fill-amber-500/30 stroke-amber-300/80',
        strokeClass: 'stroke-amber-300/80',
        strokeHoverClass: 'stroke-amber-200',
        textClass: 'text-amber-300',
        bgSoftClass: 'bg-amber-500/10',
        borderClass: 'border-amber-500/25',
        btnClass: 'bg-amber-500/15 hover:bg-amber-500/25 text-amber-200 border border-amber-500/30',
        haloHex: '#fcd34d',
      };
    default:
      return {
        fillClass: 'fill-foreground/20 stroke-foreground/40',
        strokeClass: 'stroke-foreground/40',
        strokeHoverClass: 'stroke-foreground/60',
        textClass: 'text-foreground',
        bgSoftClass: 'bg-foreground/[0.04]',
        borderClass: 'border-foreground/15',
        btnClass: 'bg-foreground/[0.06] hover:bg-foreground/[0.10] text-foreground/85 border border-foreground/15',
        haloHex: '#a1a1aa',
      };
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

/** Compact relative-time formatter. `2026-05-15T..` → `3d ago`. */
export function relativeUpdated(updatedAt: string): string {
  const t = Date.parse(updatedAt);
  if (Number.isNaN(t)) return '—';
  const sec = (Date.now() - t) / 1000;
  if (sec < 60) return 'just now';
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  if (sec < 604800) return `${Math.floor(sec / 86400)}d ago`;
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** Budget label — handles null + 0 + sub-dollar cleanly. */
export function budgetLabel(budget: number | null | undefined): string {
  if (budget == null) return '—';
  if (budget === 0) return 'free';
  if (budget < 1) return `${(budget * 100).toFixed(0)}¢`;
  return `$${budget.toFixed(2)}`;
}

/**
 * Persona "needs attention" reasons. Used by all variants to flag
 * personas that should pop visually before the user even hovers.
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
