import type { StateCreator } from "zustand";
import type { OverviewStore } from "../../storeTypes";
import { storeBus, AccessorKey } from "@/lib/storeBus";
import type { Persona } from "@/lib/bindings/Persona";
import type { PersonaHealingIssue } from "@/lib/bindings/PersonaHealingIssue";
import type { PersonaCostEntry } from "@/lib/bindings/PersonaCostEntry";
import type { ByomPolicy, ProviderUsageStats } from "@/api/system/byom";
import { getByomPolicy, getProviderUsageStats } from "@/api/system/byom";
import { getOverviewBundle } from "@/api/overview/observability";
import { listHealingIssues } from "@/api/overview/healing";
import { getHealthBundle } from "@/api/overview/health";
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
  /**
   * Where `successRate` came from for this persona:
   *  - `'measured'` — computed from this persona's actual per-day execution
   *    data (today the slice has no per-persona-per-day failure data so this
   *    case never arises; reserved for when it lands)
   *  - `'proxy'` — fleet-wide `overall_success_rate` substituted because no
   *    per-persona daily data exists (the current behaviour for active
   *    personas). Two personas in the same fleet will show identical
   *    successRate even when one is healthy and one is failing — UI must
   *    surface this caveat (e.g. a "fleet avg" badge) rather than display
   *    the number as if it were per-persona.
   *  - `'unknown'` — no activity (or fleet rate unavailable). Default 100
   *    keeps `computeHeartbeatScore` numerically stable but consumers
   *    showing health grades should distinguish unknown from healthy.
   */
  successRateSource: 'measured' | 'proxy' | 'unknown';
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
/**
 * Per-source status for the health bundle. `reason` carries the server-side
 * (or retry) failure message so the staleness banner can name *why* a source
 * is unavailable, not just *that* it is. `null` reason ⇔ `state: 'ok'`.
 */
export interface DataSourceStatus {
  state: DataSourceState;
  reason: string | null;
}
export type DataSourceStatusMap = Record<DataSourceName, DataSourceStatus>;

export interface PersonaHealthSlice {
  // State
  healthSignals: PersonaHealthSignal[];
  cascadeLinks: CascadeLink[];
  routingRecommendations: RoutingRecommendation[];
  byomPolicy: ByomPolicy | null;
  providerStats: ProviderUsageStats[];
  /**
   * Healing issues fetched by the last `computePersonaHealth` (from the health
   * bundle). Exposed on the store so other consumers (e.g. the agents
   * `healthCheckSlice` digest) can reuse them instead of issuing a third
   * `list_healing_issues` IPC of their own.
   */
  healthHealingIssues: PersonaHealingIssue[];
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
  personaDailyRates: number[],
): { trend: 'improving' | 'stable' | 'degrading'; predictedFailureDays: number | null } {
  // `personaDailyRates` is THIS persona's own daily success rate (0-100), one
  // entry per active day, chronological. Regress the trailing 14 to detect a
  // real per-persona slope instead of the fleet-wide noise the old proxy fed.
  const dailyRates = personaDailyRates.slice(-14);
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
      const aCostPer = a.total_cost_usd / Math.max(Number(a.execution_count), 1);
      const bCostPer = b.total_cost_usd / Math.max(Number(b.execution_count), 1);
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
        const cheapCostPer = cheapest.total_cost_usd / Math.max(Number(cheapest.execution_count), 1);
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
  healthHealingIssues: [],
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

        // ONE server-side join instead of four independent IPC round-trips —
        // each source is independently fail-able via `bundle.errors`, so a
        // single failing query no longer nukes the whole health view (the live
        // "Incomplete health data | Retry" banner class). Healing is bounded
        // server-side (7d + open + circuit-breaker), matching what the scorers
        // consume below.
        const bundle = await getHealthBundle(7);

        const reasons: Record<DataSourceName, string | null> = {
          monthlySpend: bundle.errors.monthlySpend,
          healingIssues: bundle.errors.healingIssues,
          byomPolicy: bundle.errors.byomPolicy,
          providerStats: bundle.errors.providerStats,
        };
        let monthlySpend = bundle.monthlySpend?.items ?? [];
        let healingIssues = bundle.healingIssues ?? ([] as PersonaHealingIssue[]);
        let byomPolicy = bundle.byomPolicy ?? null;
        let providerStats = bundle.providerStats ?? ([] as ProviderUsageStats[]);

        // Per-persona truth (Direction 2). These enrich the fleet proxy with
        // each persona's OWN measured success rate + latency + daily trend.
        // They have no standalone retry endpoint — if they fail we simply fall
        // back to the (labeled) fleet proxy, i.e. the old behaviour, so they're
        // intentionally NOT part of the retry/banner surface above.
        const personaReliability = bundle.personaStats ?? [];
        const personaDaily = bundle.personaDaily ?? [];
        const reliabilityMap = new Map(personaReliability.map(r => [r.persona_id, r]));
        const dailyRatesByPersona = new Map<string, number[]>();
        for (const d of personaDaily) {
          // persona_daily is ordered day-ascending per persona server-side, so
          // this preserves chronological order for the trend regression.
          const arr = dailyRatesByPersona.get(d.persona_id) ?? [];
          arr.push(d.success_rate * 100);
          dailyRatesByPersona.set(d.persona_id, arr);
        }

        // ONE automatic retry of ONLY the failed sources (via their individual
        // endpoints) before we ever raise a staleness banner. Covers the
        // cold-start IPC-token race where the first bundle call lands before
        // the session token is ready.
        const failedNames = (Object.keys(reasons) as DataSourceName[])
          .filter((n) => reasons[n] !== null);
        if (failedNames.length > 0) {
          await Promise.allSettled(failedNames.map(async (name) => {
            try {
              switch (name) {
                case 'monthlySpend':
                  monthlySpend = (await getOverviewBundle(30)).monthlySpend.items ?? [];
                  break;
                case 'healingIssues':
                  healingIssues = await listHealingIssues();
                  break;
                case 'byomPolicy':
                  byomPolicy = await getByomPolicy();
                  break;
                case 'providerStats':
                  providerStats = await getProviderUsageStats();
                  break;
              }
              reasons[name] = null; // retry cleared it
            } catch (e) {
              reasons[name] = e instanceof Error ? e.message : String(e);
            }
          }));
        }

        const sourceStatus: DataSourceStatusMap = {
          monthlySpend: { state: reasons.monthlySpend ? 'failed' : 'ok', reason: reasons.monthlySpend },
          healingIssues: { state: reasons.healingIssues ? 'failed' : 'ok', reason: reasons.healingIssues },
          byomPolicy: { state: reasons.byomPolicy ? 'failed' : 'ok', reason: reasons.byomPolicy },
          providerStats: { state: reasons.providerStats ? 'failed' : 'ok', reason: reasons.providerStats },
        };

        const spendMap = new Map(monthlySpend.map(s => [s.id, s]));
        const issuesByPersona = new Map<string, PersonaHealingIssue[]>();
        for (const issue of healingIssues) {
          const list = issuesByPersona.get(issue.persona_id) ?? [];
          list.push(issue);
          issuesByPersona.set(issue.persona_id, list);
        }

        // Build per-persona stats from daily points + a date-keyed index so
        // per-persona lookups inside the persona loop are O(1) instead of
        // scanning each day's persona_costs array.
        const personaCostMap = new Map<string, { totalCost: number; execCount: number; days: Set<string> }>();
        const costByDate = new Map<string, Map<string, PersonaCostEntry>>();
        for (const pt of dailyPoints) {
          const perDay = new Map<string, PersonaCostEntry>();
          for (const pc of pt.persona_costs) {
            const entry = personaCostMap.get(pc.persona_id) ?? { totalCost: 0, execCount: 0, days: new Set() };
            entry.totalCost += pc.cost;
            entry.days.add(pt.date);
            personaCostMap.set(pc.persona_id, entry);
            perDay.set(pc.persona_id, pc);
          }
          costByDate.set(pt.date, perDay);
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

          // Recent (last 7 days) — O(1) per-day lookup via the date index
          const recent7 = dailyPoints.slice(-7);
          let recentExecs = 0;
          for (const pt of recent7) {
            const personaCostShare = costByDate.get(pt.date)?.get(persona.id);
            if (personaCostShare && pt.total_cost > 0) {
              recentExecs += Math.round(pt.total_executions * (personaCostShare.cost / pt.total_cost));
            }
          }

          // Success rate: prefer this persona's OWN measured rate (Direction 2)
          // from per-persona execution stats. Only when a persona has zero
          // decided runs in the window do we fall back to the fleet-wide
          // `overall_success_rate` proxy (tagged 'proxy' so the UI can label
          // it), and to 'unknown' (100 default for scoring stability) when even
          // the fleet rate is unavailable. UI consumers MUST distinguish these
          // via `successRateSource`.
          const rel = reliabilityMap.get(persona.id);
          let successRate: number;
          let successRateSource: 'proxy' | 'measured' | 'unknown';
          if (rel && rel.total_decided > 0) {
            successRate = rel.success_rate * 100;
            successRateSource = 'measured';
          } else if (totalExecs > 0 && dashboard?.overall_success_rate !== undefined) {
            successRate = dashboard.overall_success_rate;
            successRateSource = 'proxy';
          } else {
            successRate = 100;
            successRateSource = 'unknown';
          }

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

          // Failure trend — fed by THIS persona's own daily success series
          // (Direction 2), not the fleet-wide daily series that previously made
          // every persona render an identical trend/prediction.
          const { trend: failureTrend, predictedFailureDays } =
            detectFailureTrend(dailyRatesByPersona.get(persona.id) ?? []);

          // Avg latency — per-persona measured when available, else fleet avg.
          const avgLatencyMs = rel && rel.total_decided > 0
            ? rel.avg_duration_ms
            : (dashboard?.avg_latency_ms ?? 0);

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
            successRateSource,
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
          healthHealingIssues: healingIssues,
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
  // Build links based on persona home-team (workspace) relationships
  const links: CascadeLink[] = [];
  const groupMap = new Map<string, Persona[]>();

  for (const p of personas) {
    if (p.home_team_id) {
      const list = groupMap.get(p.home_team_id) ?? [];
      list.push(p);
      groupMap.set(p.home_team_id, list);
    }
  }

  // Within each home team, create chain links
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
