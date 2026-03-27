import type { StateCreator } from "zustand";
import type { OverviewStore } from "../../storeTypes";
import { storeBus, AccessorKey } from "@/lib/storeBus";
import type { Persona } from "@/lib/bindings/Persona";
import type { PersonaHealingIssue } from "@/lib/bindings/PersonaHealingIssue";
import type { DashboardDailyPoint } from "@/lib/bindings/DashboardDailyPoint";
import type { ByomPolicy, ProviderUsageStats } from "@/api/system/byom";
import { getByomPolicy, getProviderUsageStats } from "@/api/system/byom";
import { getAllMonthlySpend } from "@/api/overview/observability";
import { listHealingIssues } from "@/api/overview/healing";
import { log } from "@/lib/log";
import { measureStoreAction } from "@/lib/utils/storePerf";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type HealthGrade = 'healthy' | 'degraded' | 'critical' | 'unknown';

export interface PersonaHealthSignal {
  personaId: string;
  personaName: string;
  personaIcon: string | null;
  personaColor: string | null;

  // Heartbeat composite
  grade: HealthGrade;
  heartbeatScore: number; // 0-100

  // Component signals
  successRate: number;         // 0-100%
  healingFrequency: number;    // issues per day (trailing 7d)
  rollbackCount: number;       // circuit-breaker issues count
  budgetRatio: number;         // 0..N (spend / max_budget)

  // Cost projection
  dailyBurnRate: number;       // $/day trailing average
  projectedExhaustionDays: number | null; // days until budget exhausted, null = no budget
  projectedMonthlyCost: number;

  // Failure prediction
  failureTrend: 'improving' | 'stable' | 'degrading';
  predictedFailureInDays: number | null; // days until predicted >50% failure rate

  // Execution stats
  totalExecutions: number;
  recentExecutions: number; // last 7 days
  avgLatencyMs: number;
}

export interface CascadeLink {
  sourcePersonaId: string;
  targetPersonaId: string;
  triggerType: string;
  strength: number; // 0-1, how often source triggers target
}

export interface RoutingRecommendation {
  personaId: string;
  personaName: string;
  currentProvider: string | null;
  recommendedProvider: string;
  reason: string;
  estimatedSaving: number; // $/month
  confidence: number; // 0-1
}

export type DataSourceName = 'monthlySpend' | 'healingIssues' | 'byomPolicy' | 'providerStats';
export type DataSourceState = 'ok' | 'failed';
export type DataSourceStatusMap = Record<DataSourceName, DataSourceState>;

export interface PersonaHealthSlice {
  // State
  healthSignals: PersonaHealthSignal[];
  cascadeLinks: CascadeLink[];
  routingRecommendations: RoutingRecommendation[];
  byomPolicy: ByomPolicy | null;
  providerStats: ProviderUsageStats[];
  healthLoading: boolean;
  healthError: string | null;
  healthLastRefreshedAt: number | null;
  dataSourceStatus: DataSourceStatusMap | null;

  // Actions
  computePersonaHealth: () => Promise<void>;
  refreshHealthDashboard: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Analytics helpers
// ---------------------------------------------------------------------------

function computeGrade(score: number): HealthGrade {
  if (score >= 80) return 'healthy';
  if (score >= 50) return 'degraded';
  if (score > 0) return 'critical';
  return 'unknown';
}

function computeHeartbeatScore(
  successRate: number,
  healingFreq: number,
  rollbackCount: number,
  budgetRatio: number,
): number {
  // Weighted composite: success rate (40%), healing freq (20%), rollbacks (20%), budget (20%)
  const successScore = successRate; // already 0-100
  const healingScore = Math.max(0, 100 - healingFreq * 25); // 4+/day = 0
  const rollbackScore = Math.max(0, 100 - rollbackCount * 33); // 3+ = 0
  const budgetScore = budgetRatio > 1 ? 0 : budgetRatio > 0.8 ? 30 : (1 - budgetRatio) * 100;

  return Math.round(
    successScore * 0.4 +
    healingScore * 0.2 +
    rollbackScore * 0.2 +
    budgetScore * 0.2
  );
}

function detectFailureTrend(
  dailyPoints: DashboardDailyPoint[],
  personaId: string,
): { trend: 'improving' | 'stable' | 'degrading'; predictedFailureDays: number | null } {
  // Get per-persona daily success rates from the last 14 days
  const recentPoints = dailyPoints.slice(-14);
  if (recentPoints.length < 3) return { trend: 'stable', predictedFailureDays: null };

  // Build daily success rates for this persona from persona_costs presence
  const dailyRates: number[] = [];
  for (const pt of recentPoints) {
    const hasActivity = pt.persona_costs.some(c => c.persona_id === personaId);
    if (hasActivity) {
      // Use global success rate as proxy since we don't have per-persona failure data per day
      dailyRates.push(pt.success_rate);
    }
  }

  if (dailyRates.length < 3) return { trend: 'stable', predictedFailureDays: null };

  // Simple linear regression on success rates
  const n = dailyRates.length;
  const xMean = (n - 1) / 2;
  const yMean = dailyRates.reduce((s, v) => s + v, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - xMean) * (dailyRates[i]! - yMean);
    den += (i - xMean) ** 2;
  }
  const slope = den !== 0 ? num / den : 0; // % change per day

  const trend: 'improving' | 'stable' | 'degrading' =
    slope > 1 ? 'improving' : slope < -1 ? 'degrading' : 'stable';

  // Predict when success rate hits 50% (catastrophic)
  let predictedFailureDays: number | null = null;
  if (slope < -0.5) {
    const currentRate = dailyRates[dailyRates.length - 1]!;
    if (currentRate > 50) {
      predictedFailureDays = Math.ceil((currentRate - 50) / Math.abs(slope));
    }
  }

  return { trend, predictedFailureDays };
}

function generateRoutingRecommendations(
  signals: PersonaHealthSignal[],
  providerStats: ProviderUsageStats[],
  policy: ByomPolicy | null,
): RoutingRecommendation[] {
  if (!policy?.enabled || providerStats.length < 2) return [];

  const recommendations: RoutingRecommendation[] = [];

  // Find the cheapest provider with decent success
  const sorted = [...providerStats]
    .filter(p => p.execution_count > 5)
    .sort((a, b) => {
      const aCostPer = a.total_cost_usd / Math.max(a.execution_count, 1);
      const bCostPer = b.total_cost_usd / Math.max(b.execution_count, 1);
      return aCostPer - bCostPer;
    });

  if (sorted.length < 2) return [];

  const cheapest = sorted[0]!;

  for (const signal of signals) {
    // Recommend switching if persona is degraded/critical AND spending heavily
    if (signal.grade !== 'healthy' && signal.dailyBurnRate > 0.5) {
      const currentProvider = policy.routing_rules.find(r => r.enabled)?.provider ?? null;
      if (currentProvider && currentProvider !== cheapest.engine_kind) {
        const costPerExec = signal.totalExecutions > 0
          ? (signal.projectedMonthlyCost / Math.max(signal.recentExecutions, 1)) * 30
          : 0;
        const cheapCostPer = cheapest.total_cost_usd / Math.max(cheapest.execution_count, 1);
        const saving = Math.max(0, costPerExec - cheapCostPer * signal.recentExecutions);

        if (saving > 1) {
          recommendations.push({
            personaId: signal.personaId,
            personaName: signal.personaName,
            currentProvider,
            recommendedProvider: cheapest.engine_kind,
            reason: signal.grade === 'critical'
              ? `Critical health with high burn rate ($${signal.dailyBurnRate.toFixed(2)}/day)`
              : `Degraded performance — cheaper provider available`,
            estimatedSaving: Math.round(saving * 100) / 100,
            confidence: signal.totalExecutions > 20 ? 0.8 : 0.5,
          });
        }
      }
    }
  }

  return recommendations;
}

// ---------------------------------------------------------------------------
// Slice
// ---------------------------------------------------------------------------

export const createPersonaHealthSlice: StateCreator<OverviewStore, [], [], PersonaHealthSlice> = (set, get) => ({
  healthSignals: [],
  cascadeLinks: [],
  routingRecommendations: [],
  byomPolicy: null,
  providerStats: [],
  healthLoading: false,
  healthError: null,
  healthLastRefreshedAt: null,
  dataSourceStatus: null,

  computePersonaHealth: async () => {
    set({ healthLoading: true, healthError: null });
    try {
      await measureStoreAction('computePersonaHealth', async () => {
        const personas = storeBus.get<Persona[]>(AccessorKey.AGENTS_PERSONAS);
        const dashboard = get().executionDashboard;
        const dailyPoints = dashboard?.daily_points ?? [];

        // Fetch supplementary data using allSettled to avoid mutating shared
        // state inside concurrent catch handlers (race when called twice rapidly)
        const settled = await Promise.allSettled([
          getAllMonthlySpend(),
          listHealingIssues(),
          getByomPolicy(),
          getProviderUsageStats(),
        ]);

        const monthlySpendResult = settled[0].status === 'fulfilled'
          ? settled[0].value
          : null;
        const monthlySpend = monthlySpendResult?.items ?? [];
        const healingIssues = settled[1].status === 'fulfilled'
          ? settled[1].value
          : [] as PersonaHealingIssue[];
        const byomPolicy = settled[2].status === 'fulfilled'
          ? settled[2].value
          : null;
        const providerStats = settled[3].status === 'fulfilled'
          ? settled[3].value
          : [] as ProviderUsageStats[];

        const sourceStatus: DataSourceStatusMap = {
          monthlySpend: settled[0].status === 'fulfilled' ? 'ok' : 'failed',
          healingIssues: settled[1].status === 'fulfilled' ? 'ok' : 'failed',
          byomPolicy: settled[2].status === 'fulfilled' ? 'ok' : 'failed',
          providerStats: settled[3].status === 'fulfilled' ? 'ok' : 'failed',
        };

        const spendMap = new Map(monthlySpend.map(s => [s.id, s]));
        const issuesByPersona = new Map<string, PersonaHealingIssue[]>();
        for (const issue of healingIssues) {
          const list = issuesByPersona.get(issue.persona_id) ?? [];
          list.push(issue);
          issuesByPersona.set(issue.persona_id, list);
        }

        // Build per-persona stats from daily points
        const personaCostMap = new Map<string, { totalCost: number; execCount: number; days: Set<string> }>();
        for (const pt of dailyPoints) {
          for (const pc of pt.persona_costs) {
            const entry = personaCostMap.get(pc.persona_id) ?? { totalCost: 0, execCount: 0, days: new Set() };
            entry.totalCost += pc.cost;
            entry.days.add(pt.date);
            personaCostMap.set(pc.persona_id, entry);
          }
        }

        // Count executions from top_personas
        const topMap = new Map((dashboard?.top_personas ?? []).map(tp => [tp.persona_id, tp]));

        const signals: PersonaHealthSignal[] = [];

        for (const persona of personas) {
          const spend = spendMap.get(persona.id);
          const issues = issuesByPersona.get(persona.id) ?? [];
          const costEntry = personaCostMap.get(persona.id);
          const topPersona = topMap.get(persona.id);

          const totalExecs = topPersona?.total_executions ?? 0;
          const totalCost = costEntry?.totalCost ?? 0;
          const activeDays = costEntry?.days.size ?? 1;

          // Recent (last 7 days)
          const recent7 = dailyPoints.slice(-7);
          let recentExecs = 0;
          for (const pt of recent7) {
            if (pt.persona_costs.some(c => c.persona_id === persona.id)) {
              // Approximate from global proportions
              const personaCostShare = pt.persona_costs.find(c => c.persona_id === persona.id);
              if (personaCostShare && pt.total_cost > 0) {
                recentExecs += Math.round(pt.total_executions * (personaCostShare.cost / pt.total_cost));
              }
            }
          }

          // Success rate (use top persona's data or global)
          const successRate = totalExecs > 0
            ? (dashboard?.overall_success_rate ?? 100)
            : 100;

          // Healing frequency
          const recentIssues = issues.filter(i => {
            const d = new Date(i.created_at);
            return Date.now() - d.getTime() < 7 * 86400_000;
          });
          const healingFrequency = recentIssues.length / 7;

          // Rollback (circuit breaker) count
          const rollbackCount = issues.filter(i => i.is_circuit_breaker).length;

          // Budget
          const budgetRatio = spend?.max_budget_usd
            ? (spend.spend / spend.max_budget_usd)
            : 0;

          // Burn rate
          const dailyBurnRate = activeDays > 0 ? totalCost / activeDays : 0;
          const projectedMonthlyCost = dailyBurnRate * 30;

          // Budget exhaustion
          let projectedExhaustionDays: number | null = null;
          if (spend?.max_budget_usd && dailyBurnRate > 0) {
            const remaining = spend.max_budget_usd - spend.spend;
            if (remaining > 0) {
              projectedExhaustionDays = Math.ceil(remaining / dailyBurnRate);
            } else {
              projectedExhaustionDays = 0; // already exhausted
            }
          }

          // Failure trend
          const { trend: failureTrend, predictedFailureDays } = detectFailureTrend(dailyPoints, persona.id);

          // Avg latency
          const avgLatencyMs = dashboard?.avg_latency_ms ?? 0;

          // Heartbeat score
          const heartbeatScore = computeHeartbeatScore(successRate, healingFrequency, rollbackCount, budgetRatio);

          signals.push({
            personaId: persona.id,
            personaName: persona.name,
            personaIcon: persona.icon,
            personaColor: persona.color,
            grade: computeGrade(heartbeatScore),
            heartbeatScore,
            successRate,
            healingFrequency,
            rollbackCount,
            budgetRatio,
            dailyBurnRate,
            projectedExhaustionDays,
            projectedMonthlyCost,
            failureTrend,
            predictedFailureInDays: predictedFailureDays,
            totalExecutions: totalExecs,
            recentExecutions: recentExecs,
            avgLatencyMs,
          });
        }

        // Sort by health score ascending (worst first)
        signals.sort((a, b) => a.heartbeatScore - b.heartbeatScore);

        // Generate cascade links from event subscriptions
        const cascadeLinks = buildCascadeLinks(personas);

        // Generate routing recommendations
        const recommendations = generateRoutingRecommendations(signals, providerStats, byomPolicy);

        set({
          healthSignals: signals,
          cascadeLinks,
          routingRecommendations: recommendations,
          byomPolicy,
          providerStats,
          healthLoading: false,
          healthLastRefreshedAt: Date.now(),
          dataSourceStatus: sourceStatus,
        });
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn('personaHealthSlice', 'computePersonaHealth failed', { error: msg });
      set({ healthError: msg, healthLoading: false });
    }
  },

  refreshHealthDashboard: async () => {
    await measureStoreAction('refreshHealthDashboard', async () => {
      // Ensure dashboard data is fresh, then recompute health
      await get().fetchExecutionDashboard();
      await get().computePersonaHealth();
    });
  },
});

// ---------------------------------------------------------------------------
// Cascade link builder
// ---------------------------------------------------------------------------

function buildCascadeLinks(personas: Persona[]): CascadeLink[] {
  // Build links based on persona group relationships
  const links: CascadeLink[] = [];
  const groupMap = new Map<string, Persona[]>();

  for (const p of personas) {
    if (p.group_id) {
      const list = groupMap.get(p.group_id) ?? [];
      list.push(p);
      groupMap.set(p.group_id, list);
    }
  }

  // Within each group, create chain links
  for (const members of groupMap.values()) {
    for (let i = 0; i < members.length - 1; i++) {
      links.push({
        sourcePersonaId: members[i]!.id,
        targetPersonaId: members[i + 1]!.id,
        triggerType: 'group-chain',
        strength: 0.7,
      });
    }
  }

  return links;
}
