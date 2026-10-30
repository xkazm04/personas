/**
 * THE definition of agent health. Both surfaces that grade an agent read it:
 * the editor HealthBadge / Arena herald (`useHealthCheck`, one agent) and the
 * weekly digest (`healthCheckSlice.runFullHealthDigest`, the fleet).
 *
 * Until 2026-10-30 they graded by two definitions under one word: the badge
 * scored design feasibility (`test_design_feasibility`), the digest scored live
 * telemetry, so an agent with healthy telemetry and no stored design read
 * "degraded 75" in the editor and "healthy 100" in the digest. The digest had
 * already dropped the feasibility check because it "produced low-signal items
 * like 'Missing structured_prompt section'"; the badge now follows it.
 *
 * The definition: open healing issues + the overview telemetry signals
 * (heartbeat, burn rate, failure trend) + the persona's config warnings
 * (malformed chain triggers, ambiguous tool kinds). Config warnings were the
 * badge's one real operational sub-check, so they joined the shared definition
 * instead of being dropped.
 *
 * Error policy for a best-effort sub-check (config warnings): route the error
 * through `silentCatch`, add ONE `undetermined` issue (a claim about the check,
 * never scored), and keep going. The telemetry pipeline is not best-effort: if
 * it errored, the signals on the store are stale or empty and grading them
 * would call every agent healthy, so the assessment throws instead.
 *
 * No store or hook is imported here except the overview store, so the agent
 * store's slice can import this module without closing an import cycle.
 */
import { useOverviewStore } from '@/stores/overviewStore';
import { getPersonaConfigWarnings } from '@/api/pipeline/triggers';
import { silentCatch } from '@/lib/silentCatch';
import { mapWithConcurrency } from '@/lib/concurrency';
import { getActiveTranslations, interpolate } from '@/i18n/useTranslation';
import type { ConfigWarning } from '@/lib/bindings/ConfigWarning';
import type { Persona } from '@/lib/bindings/Persona';
import type { PersonaHealingIssue } from '@/lib/bindings/PersonaHealingIssue';
import type { PersonaHealthSignal } from '@/stores/slices/overview/personaHealthSlice';
import { makeIssueId } from './healthScoring';
import type { DryRunIssue, DryRunResult, PersonaHealthCheck } from './types';

const HIGH_LATENCY_MS = 30_000;

const VALID_SEVERITIES: ReadonlySet<DryRunIssue['severity']> = new Set(['error', 'warning', 'info', 'undetermined']);

function validateSeverity(value: string): DryRunIssue['severity'] {
  const lower = value.toLowerCase();
  // Narrowed by the set membership test, not asserted past it.
  return VALID_SEVERITIES.has(lower as DryRunIssue['severity']) ? (lower as DryRunIssue['severity']) : 'warning';
}

function pushIssue(list: DryRunIssue[], personaId: string, severity: DryRunIssue['severity'], description: string): void {
  list.push({ id: makeIssueId(personaId, severity, description), severity, description });
}

function telemetryIssues(persona: Persona, signal: PersonaHealthSignal | undefined, healingIssues: PersonaHealingIssue[]): DryRunIssue[] {
  const t = getActiveTranslations().agents.health_digest;
  const issues: DryRunIssue[] = [];

  // Healing: itemise each open issue so the drill-down lists actionable detail.
  const openHealing = healingIssues.filter((h) => h.status !== 'resolved');
  for (const h of openHealing) {
    const sev = h.severity.toLowerCase();
    if (sev === 'error' || sev === 'critical' || h.is_circuit_breaker) {
      pushIssue(issues, persona.id, 'error', interpolate(t.signal_open_healing_error, { title: h.title }));
    } else if (sev === 'warning' || sev === 'warn') {
      pushIssue(issues, persona.id, 'warning', interpolate(t.signal_open_healing_warning, { title: h.title }));
    }
  }

  if (!signal) {
    // No telemetry yet: flag once as info so the agent still appears.
    if (openHealing.length === 0) pushIssue(issues, persona.id, 'info', t.signal_unknown);
    return issues;
  }

  // Errors: high-confidence operational breakage.
  if (signal.rollbackCount > 0) {
    pushIssue(issues, persona.id, 'error', interpolate(t.signal_circuit_breaker, { count: signal.rollbackCount }));
  }
  // One fact, one charge. `projectedExhaustionDays === 0` is defined as
  // `max_budget - spend <= 0` (personaHealthSlice.ts), the same condition as
  // `budgetRatio >= 1`. Emitting both cost an agent that had merely hit its
  // cap two error penalties for one overrun. Prefer the more specific wording.
  if (signal.projectedExhaustionDays === 0) {
    pushIssue(issues, persona.id, 'error', t.signal_budget_exhausted);
  } else if (signal.budgetRatio >= 1) {
    pushIssue(issues, persona.id, 'error', interpolate(t.signal_over_budget, { pct: Math.round(signal.budgetRatio * 100) }));
  }

  // Warnings: degrading state worth attention.
  if (signal.budgetRatio > 0.8 && signal.budgetRatio < 1) {
    pushIssue(issues, persona.id, 'warning', interpolate(t.signal_budget_near_cap, { pct: Math.round(signal.budgetRatio * 100) }));
  }
  if (signal.projectedExhaustionDays !== null && signal.projectedExhaustionDays > 0 && signal.projectedExhaustionDays <= 7) {
    pushIssue(issues, persona.id, 'warning', interpolate(t.signal_budget_exhausts_soon, { days: signal.projectedExhaustionDays }));
  }
  if (signal.healingFrequency > 0.5) {
    const recent7 = Math.round(signal.healingFrequency * 7);
    if (recent7 > 0) pushIssue(issues, persona.id, 'warning', interpolate(t.signal_healing_frequency, { count: recent7 }));
  }
  if (signal.failureTrend === 'degrading') {
    pushIssue(issues, persona.id, 'warning', t.signal_failure_trend_degrading);
  }
  if (signal.successRateSource !== 'unknown' && signal.successRate < 80) {
    pushIssue(issues, persona.id, 'warning', interpolate(t.signal_low_success_rate, { pct: Math.round(signal.successRate) }));
  }

  // Info: soft hints, not blocking.
  if (signal.totalExecutions > 0 && signal.recentExecutions === 0) {
    pushIssue(issues, persona.id, 'info', t.signal_inactive);
  }
  if (signal.predictedFailureInDays !== null && signal.predictedFailureInDays <= 30) {
    pushIssue(issues, persona.id, 'info', interpolate(t.signal_predicted_failure, { days: signal.predictedFailureInDays }));
  }
  if (signal.avgLatencyMs > HIGH_LATENCY_MS) {
    pushIssue(issues, persona.id, 'info', interpolate(t.signal_high_latency, { seconds: Math.round(signal.avgLatencyMs / 1000) }));
  }

  if (issues.length === 0 && signal.totalExecutions === 0) {
    pushIssue(issues, persona.id, 'info', t.signal_unknown);
  }
  return issues;
}

/** The config-warning read's outcome: "the door failed" is not "no warnings". */
export type ConfigWarningsRead =
  | { status: 'ok'; warnings: readonly ConfigWarning[] }
  | { status: 'unavailable' };

const NO_WARNINGS: ConfigWarningsRead = { status: 'ok', warnings: [] };

/**
 * Grade one persona. An `unavailable` config-warning read becomes one
 * `undetermined` issue, not a penalty on the persona.
 */
export function buildResultFromSignals(
  persona: Persona,
  signal: PersonaHealthSignal | undefined,
  healingIssues: PersonaHealingIssue[],
  configWarnings: ConfigWarningsRead = NO_WARNINGS,
): DryRunResult {
  const issues = telemetryIssues(persona, signal, healingIssues);
  if (configWarnings.status === 'unavailable') {
    pushIssue(issues, persona.id, 'undetermined', getActiveTranslations().agents.health_check.config_warnings_unavailable);
  } else {
    for (const w of configWarnings.warnings) pushIssue(issues, persona.id, validateSeverity(w.severity), w.description);
  }
  return { status: statusFor(issues), issues };
}

/** `undetermined` is about the check, not the persona, so it never moves the status. */
function statusFor(issues: DryRunIssue[]): DryRunResult['status'] {
  if (issues.some((i) => i.severity === 'error')) return 'blocked';
  if (issues.some((i) => i.severity === 'warning')) return 'partial';
  return 'ready';
}

/**
 * Refresh the telemetry pipeline once and grade every persona given. Throws
 * when the pipeline itself failed (see the module comment).
 */
export async function assessAgentHealth(personas: readonly Persona[]): Promise<PersonaHealthCheck[]> {
  await useOverviewStore.getState().refreshHealthDashboard();
  const overview = useOverviewStore.getState();
  if (overview.healthError) throw new Error(overview.healthError);

  const signalById = new Map(overview.healthSignals.map((s) => [s.personaId, s] as const));
  const healingByPersona = new Map<string, PersonaHealingIssue[]>();
  for (const h of overview.healthHealingIssues) {
    const list = healingByPersona.get(h.persona_id) ?? [];
    list.push(h);
    healingByPersona.set(h.persona_id, list);
  }

  // One small DB read per persona, bounded: the digest grades the whole fleet.
  const warnings = await mapWithConcurrency(personas, CONFIG_WARNING_READ_WIDTH, (p) => readConfigWarnings(p.id));

  const checkedAt = new Date().toISOString();
  return personas.map((persona, i) => ({
    personaId: persona.id,
    personaName: persona.name,
    personaIcon: persona.icon,
    personaColor: persona.color,
    result: buildResultFromSignals(
      persona,
      signalById.get(persona.id),
      healingByPersona.get(persona.id) ?? [],
      warnings[i] ?? UNAVAILABLE,
    ),
    checkedAt,
  }));
}

/** Concurrent config-warning reads during a fleet assessment. */
const CONFIG_WARNING_READ_WIDTH = 4;

const UNAVAILABLE: ConfigWarningsRead = { status: 'unavailable' };

/** A failed read stays a failed read: tagged, never an empty list. */
async function readConfigWarnings(personaId: string): Promise<ConfigWarningsRead> {
  try {
    return { status: 'ok', warnings: await getPersonaConfigWarnings(personaId) };
  } catch (err) {
    silentCatch('agentHealth:configWarnings')(err);
    return UNAVAILABLE;
  }
}
