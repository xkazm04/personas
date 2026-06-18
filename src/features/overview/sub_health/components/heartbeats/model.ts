import { useMemo } from 'react';
import type {
  HealthGrade,
  PersonaHealthSignal,
  CascadeLink,
  RoutingRecommendation,
  DataSourceName,
} from '@/stores/slices/overview/personaHealthSlice';
import type { Translations } from '@/i18n/generated/types';

// ---------------------------------------------------------------------------
// Shared model + design tokens for the Vitals Ledger heartbeats view.
// ---------------------------------------------------------------------------

export const DATA_SOURCE_LABELS: Record<DataSourceName, string> = {
  monthlySpend: 'Monthly spend (local tz)',
  healingIssues: 'Healing issues',
  byomPolicy: 'BYOM policy',
  providerStats: 'Provider stats',
};

/** Single source of truth for grade → semantic-token styling. */
export const GRADE_THEME: Record<HealthGrade, {
  text: string; bar: string; track: string; soft: string;
  border: string; ring: string; dot: string; chip: string;
}> = {
  critical: {
    text: 'text-status-error', bar: 'bg-status-error', track: 'bg-status-error/10', soft: 'bg-status-error/[0.06]',
    border: 'border-status-error/20', ring: 'ring-status-error/30', dot: 'bg-status-error',
    chip: 'bg-status-error/15 text-status-error border-status-error/25',
  },
  degraded: {
    text: 'text-status-warning', bar: 'bg-status-warning', track: 'bg-status-warning/10', soft: 'bg-status-warning/[0.06]',
    border: 'border-status-warning/20', ring: 'ring-status-warning/30', dot: 'bg-status-warning',
    chip: 'bg-status-warning/15 text-status-warning border-status-warning/25',
  },
  unknown: {
    text: 'text-zinc-400', bar: 'bg-zinc-500', track: 'bg-zinc-500/10', soft: 'bg-zinc-500/[0.06]',
    border: 'border-zinc-500/20', ring: 'ring-zinc-500/30', dot: 'bg-zinc-500',
    chip: 'bg-zinc-500/15 text-zinc-400 border-zinc-500/25',
  },
  healthy: {
    text: 'text-status-success', bar: 'bg-status-success', track: 'bg-status-success/10', soft: 'bg-status-success/[0.06]',
    border: 'border-status-success/20', ring: 'ring-status-success/30', dot: 'bg-status-success',
    chip: 'bg-status-success/15 text-status-success border-status-success/25',
  },
};

export function gradeFromScore(score: number): HealthGrade {
  if (score >= 80) return 'healthy';
  if (score >= 50) return 'degraded';
  if (score > 0) return 'critical';
  return 'unknown';
}

export type SegKey = 'success' | 'healing' | 'stability' | 'budget';
export interface SubScore { key: SegKey; score: number; detail: string }

/**
 * Decompose a signal into the four sub-scores that feed `computeHeartbeatScore`
 * in the slice — so the segmented bar diagnoses *why* a persona is unhealthy,
 * not just the composite. Mirrors the slice weighting (success 40, healing 20,
 * stability 20, budget 20).
 */
export function subScores(s: PersonaHealthSignal): SubScore[] {
  const healingScore = Math.max(0, 100 - s.healingFrequency * 25);
  const rollbackScore = Math.max(0, 100 - s.rollbackCount * 33);
  const budgetScore = s.budgetRatio > 1 ? 0 : s.budgetRatio > 0.8 ? 30 : (1 - s.budgetRatio) * 100;
  return [
    { key: 'success', score: Math.round(s.successRate), detail: `${s.successRate.toFixed(0)}%` },
    { key: 'healing', score: Math.round(healingScore), detail: `${s.healingFrequency.toFixed(1)}/d` },
    { key: 'stability', score: Math.round(rollbackScore), detail: `${s.rollbackCount}` },
    { key: 'budget', score: Math.round(budgetScore), detail: `${(s.budgetRatio * 100).toFixed(0)}%` },
  ];
}

export function segLabels(t: Translations): Record<SegKey, string> {
  const h = t.overview.heartbeats;
  return { success: h.seg_success, healing: h.seg_healing, stability: h.seg_stability, budget: h.seg_budget };
}

export interface HeartbeatsModel {
  counts: { all: number } & Record<HealthGrade, number>;
  globalScore: number;
  globalGrade: HealthGrade;
  sorted: PersonaHealthSignal[];        // all, worst-first
  unhealthy: PersonaHealthSignal[];     // grade !== healthy, worst-first
  healthy: PersonaHealthSignal[];
  byGrade: Record<HealthGrade, PersonaHealthSignal[]>;
}

export function useHeartbeatsModel(signals: PersonaHealthSignal[]): HeartbeatsModel {
  return useMemo(() => {
    const counts = { all: signals.length, healthy: 0, degraded: 0, critical: 0, unknown: 0 };
    const byGrade: Record<HealthGrade, PersonaHealthSignal[]> = { healthy: [], degraded: [], critical: [], unknown: [] };
    for (const s of signals) { counts[s.grade]++; byGrade[s.grade].push(s); }
    const sorted = [...signals].sort((a, b) => a.heartbeatScore - b.heartbeatScore);
    const unhealthy = sorted.filter(s => s.grade !== 'healthy');
    const healthy = sorted.filter(s => s.grade === 'healthy');
    const globalScore = signals.length
      ? Math.round(signals.reduce((sum, s) => sum + s.heartbeatScore, 0) / signals.length)
      : 0;
    return { counts, globalScore, globalGrade: gradeFromScore(globalScore), sorted, unhealthy, healthy, byGrade };
  }, [signals]);
}

export interface HeartbeatsVariantProps {
  signals: PersonaHealthSignal[];
  model: HeartbeatsModel;
  loading: boolean;
  cascadeLinks: CascadeLink[];
  routingRecommendations: RoutingRecommendation[];
}

export const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
