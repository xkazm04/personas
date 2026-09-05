/**
 * Health-check module.
 *
 * ## Error policy for best-effort sub-checks
 *
 * A health check aggregates several independent sub-checks (design feasibility,
 * config-warnings, etc.). Any sub-check that is *enrichment* — i.e. its failure
 * does not invalidate the rest of the health score — follows this contract:
 *
 *   1. Route the error through [`silentCatch`] so Sentry gets a breadcrumb.
 *      An empty `catch {}` is never acceptable — "healthy" must never mean
 *      "the backend command threw and we pretended it was fine".
 *   2. Append a single **`undetermined`** issue to the result noting that the
 *      sub-check could not run, with enough context for the user to see that
 *      the score is incomplete. Not `info`: an info penalty charges the
 *      persona for the prober's own outage (see `DryRunIssue.severity`).
 *   3. Never throw out of the main check. Other sub-checks still produce
 *      useful signal; a transient IPC failure in one must not blank the tab.
 *
 * This policy is documented in one place (here) and applied consistently to
 * the `get_persona_config_warnings` fetch below. New best-effort sub-checks
 * MUST follow the same three-step shape or justify a deviation inline.
 */

import { useState, useCallback, useRef, useMemo } from 'react';
import { testDesignFeasibility, type FeasibilityResult } from '@/api/design/design';
import { useVaultStore } from "@/stores/vaultStore";
import { useAgentStore } from "@/stores/agentStore";
import { parseJsonOrDefault } from '@/lib/utils/parseJson';
import { getPersonaConfigWarnings } from '@/api/pipeline/triggers';
import { silentCatch } from '@/lib/silentCatch';
import type { Persona } from '@/lib/bindings/Persona';
import type { DesignContextData } from '@/lib/types/frontendTypes';
import type { DryRunResult, DryRunIssue, PersonaHealthCheck, HealthScore, HealthGrade } from './types';
import { inferIssueSeverity } from '@/lib/errorTaxonomy';
import { getActiveTranslations } from '@/i18n/useTranslation';
import { GRADE_THRESHOLDS } from '@/features/overview/sub_health/libs/compositeHealthScore';

/**
 * Health scoring configuration. Single source of truth for penalty weights
 * and grade cutoffs — tests and UI both import from here.
 *
 * Rationale:
 * - `errorPenalty` 25 → four unresolved errors = score 0 (failing).
 * - `warningPenalty` 10 → warnings tip a healthy persona into "degraded"
 *   after 3 before dragging it toward "unhealthy".
 * - `infoPenalty` 2 → informational notes nudge the score without dominating.
 * - `degradedCutoff` 80 / `unhealthyCutoff` 50 align with the three grade
 *   bands the editor HealthBadge (EditorTabBar) and the Arena herald paint
 *   (healthy / degraded / unhealthy). HealthScoreDisplay was deleted in
 *   fbf3e6a6a.
 */
export const HEALTH_SCORING = {
  errorPenalty: 25,
  warningPenalty: 10,
  infoPenalty: 2,
  maxScore: 100,
  minScore: 0,
  /**
   * Scores >= this are "healthy". Sourced from the single `GRADE_THRESHOLDS`
   * in the health scoring module so the digest's grade bands can't drift from
   * the Heartbeats / Status-page bands. (The digest keeps its own penalty-based
   * *scoring* — it grades issue severity, not the telemetry composite — but the
   * cutoffs are shared.)
   */
  degradedCutoff: GRADE_THRESHOLDS.healthy,
  /** Scores < this are "unhealthy"; between unhealthyCutoff and degradedCutoff is "degraded". */
  unhealthyCutoff: GRADE_THRESHOLDS.degraded,
} as const;

const VALID_SEVERITIES: ReadonlySet<DryRunIssue['severity']> = new Set([
  'error',
  'warning',
  'info',
  'undetermined',
]);

function validateSeverity(value: string): DryRunIssue['severity'] {
  const lower = value.toLowerCase() as DryRunIssue['severity'];
  return VALID_SEVERITIES.has(lower) ? lower : 'warning';
}

// -- Scoring helpers --------------------------------------------------

export function computeHealthScore(issues: DryRunIssue[]): HealthScore {
  const unresolved = issues.filter((i) => !i.resolved);
  const errors = unresolved.filter((i) => i.severity === 'error').length;
  const warnings = unresolved.filter((i) => i.severity === 'warning').length;
  const infos = unresolved.filter((i) => i.severity === 'info').length;

  const penalty =
    errors * HEALTH_SCORING.errorPenalty +
    warnings * HEALTH_SCORING.warningPenalty +
    infos * HEALTH_SCORING.infoPenalty;
  const value = Math.max(HEALTH_SCORING.minScore, Math.min(HEALTH_SCORING.maxScore, HEALTH_SCORING.maxScore - penalty));

  let grade: HealthGrade = 'healthy';
  if (value < HEALTH_SCORING.unhealthyCutoff) grade = 'unhealthy';
  else if (value < HEALTH_SCORING.degradedCutoff) grade = 'degraded';

  return { value, grade };
}

// -- Design context reconstruction ------------------------------------

/**
 * Never null: a persona with no (or unparseable) design_context gets a minimal
 * context built from its own fields, so the feasibility check always has
 * something to run against. The hook used to guard a `null` here and surface
 * `error_no_design_context`, a branch this function could not reach.
 */
function personaToDesignContext(persona: Persona): DesignContextData {
  if (persona.design_context) {
    const ctx = parseJsonOrDefault<DesignContextData | null>(persona.design_context, null);
    if (ctx) return ctx;
  }

  // Fallback: build a minimal context from persona fields
  return {
    summary: persona.description || persona.name,
  };
}

// -- Issue generation from feasibility --------------------------------

/**
 * Generate a deterministic issue ID from `(personaId, severity, description)`.
 *
 * Why deterministic: re-running a health check used to mint fresh random IDs,
 * so any client holding a prior `issueId` (a debounced `markIssueResolved`,
 * an in-flight fix proposal) silently no-op'd against the new result set.
 * Hashing the issue's content keeps identity stable across runs — unchanged
 * issues keep the same ID, and `markIssueResolved` continues to match after
 * a re-check. Determinism also enables future diffing of issue sets across
 * runs.
 *
 * Implementation: 64-bit FNV-1a, hex-encoded. Non-cryptographic, but the
 * collision space is wide enough for the per-persona issue counts we ever
 * surface in the UI.
 *
 * Exported for unit tests.
 */
export function makeIssueId(personaId: string, severity: string, description: string): string {
  const FNV_OFFSET = 0xcbf29ce484222325n;
  const FNV_PRIME = 0x100000001b3n;
  const MASK64 = (1n << 64n) - 1n;
  const input = `${personaId}\u0000${severity}\u0000${description}`;
  let hash = FNV_OFFSET;
  for (let i = 0; i < input.length; i++) {
    hash = (hash ^ BigInt(input.charCodeAt(i))) & MASK64;
    hash = (hash * FNV_PRIME) & MASK64;
  }
  return `hc_${hash.toString(16).padStart(16, '0')}`;
}

/**
 * Map the backend's free-form `overall` string to the discriminated
 * `DryRunResult['status']` union. Exported so the digest slice and any
 * future caller can share one mapping (drift between hook + slice was
 * the source of the W2.6 audit finding).
 */
export function mapOverallStatus(overall: string): DryRunResult['status'] {
  const o = overall.toLowerCase();
  if (o.includes('ready') || o.includes('pass') || o.includes('success')) return 'ready';
  if (o.includes('block') || o.includes('fail')) return 'blocked';
  return 'partial';
}

/**
 * Pattern → proposal rules. Iterated in order; first rule whose `keywords`
 * substring-match the lowercased issue text and whose `build` returns a
 * non-null proposal wins. A rule whose keywords match but whose `build`
 * returns null **falls through** to subsequent rules — used by the
 * credential rule when neither sub-condition can produce an actionable
 * fix. Adding a new auto-fix is one push to this array.
 */
type ProposalCredential = { id: string; service_type: string };

interface ProposalRule {
  keywords: readonly string[];
  build: (
    issueText: string,
    persona: Persona,
    credentials: ProposalCredential[],
  ) => DryRunIssue['proposal'];
}

const PROPOSAL_RULES: readonly ProposalRule[] = [
  {
    keywords: ['credential', 'auth'],
    build: (_issueText, persona, credentials) => {
      const ctx = parseJsonOrDefault<DesignContextData | null>(persona.design_context, null);
      if (ctx?.credentialLinks) {
        const unlinked = Object.entries(ctx.credentialLinks).filter(([, credId]) => !credId);
        if (unlinked.length > 0) {
          const connector = unlinked[0]![0];
          const match = credentials.find((c) => c.service_type === connector);
          if (match) {
            return {
              labelKey: 'link_credential',
              labelParams: { connector },
              actions: [{ type: 'UPDATE_COMPONENT_CREDENTIAL', payload: { componentId: connector, credentialId: match.id } }],
            };
          }
        }
      }
      if (credentials.length > 0) {
        return {
          labelKey: 'auto_match_credentials',
          actions: [{ type: 'AUTO_MATCH_CREDENTIALS', payload: { credentials } }],
        };
      }
      return null;
    },
  },
  {
    keywords: ['schedule', 'trigger', 'cron'],
    build: () => ({
      labelKey: 'add_daily_schedule',
      // 'Daily 9 AM' is a seed name written into the persona's design_context;
      // it stays English (user data, not display chrome).
      actions: [{ type: 'SET_GLOBAL_TRIGGER', payload: { label: 'Daily 9 AM', type: 'schedule', cron: '0 9 * * *' } }],
    }),
  },
  {
    keywords: ['error handling', 'error strategy', 'retry'],
    build: () => ({
      labelKey: 'switch_retry_3x',
      actions: [{ type: 'SET_ERROR_STRATEGY', payload: 'retry-3x' }],
    }),
  },
  {
    keywords: ['use case', 'usecase', 'workflow'],
    build: () => ({
      labelKey: 'add_default_use_case',
      // Title / description are seed values written into the persona's
      // design_context; they stay English (user data, not display chrome).
      actions: [{
        type: 'ADD_USE_CASE_WITH_DATA',
        payload: { title: 'Primary Automation', description: 'Core workflow for this agent', category: 'automation' },
      }],
    }),
  },
  {
    keywords: ['review', 'approval', 'human'],
    build: () => ({
      labelKey: 'enable_first_run_review',
      actions: [{ type: 'SET_REVIEW_POLICY', payload: 'on-first-run' }],
    }),
  },
];

function generateHealthProposal(
  issueText: string,
  persona: Persona,
  credentials: ProposalCredential[],
): DryRunIssue['proposal'] {
  const lower = issueText.toLowerCase();
  for (const rule of PROPOSAL_RULES) {
    if (rule.keywords.some((k) => lower.includes(k))) {
      const proposal = rule.build(issueText, persona, credentials);
      if (proposal) return proposal;
    }
  }
  return null;
}

/**
 * Coerce a single raw issue entry to a display string. The IPC contract
 * declares `string[]`, but the backend could evolve (richer objects) or a
 * transport glitch could insert null/undefined. Accept strings directly,
 * extract a `description`/`message`/`text` field from object shapes, and
 * drop anything that can't be rendered without becoming "[object Object]".
 *
 * Exported so the digest slice (and any future caller) can share one
 * coercion routine — previously the slice did plain `.map(text => ...)`
 * which would render "[object Object]" if the backend ever returned a
 * richer shape.
 */
export function coerceIssueText(raw: unknown): string | null {
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (raw && typeof raw === 'object') {
    const record = raw as Record<string, unknown>;
    for (const key of ['description', 'message', 'text', 'detail'] as const) {
      const candidate = record[key];
      if (typeof candidate === 'string' && candidate.trim().length > 0) {
        return candidate.trim();
      }
    }
  }
  return null;
}

/**
 * Options for {@link parseFeasibilityToHealthResult}.
 */
export interface ParseFeasibilityOptions {
  /**
   * When `true` (default), run the keyword cascade in `generateHealthProposal`
   * and attach `proposal` to each issue.
   *
   * The aggregate digest slice passes `false` because the digest UI shows a
   * summary only — fixes are applied from the per-persona panel that calls
   * the hook with the default. Skipping proposal generation also avoids the
   * cost of re-walking design context per issue when the digest fans out
   * across many personas.
   */
  withProposals?: boolean;
}

/**
 * Parse a backend `FeasibilityResult` into the canonical `DryRunResult` used
 * by both the per-persona health hook and the aggregate digest slice. Single
 * source of truth — drift between two near-identical implementations was the
 * W2.6 audit finding (deterministic vs random IDs, plain map vs coercion).
 *
 * Notes on identity:
 * - Issue IDs come from {@link makeIssueId} (FNV-64) so the same issue keeps
 *   the same ID across re-runs and across hook/slice paths. This is what
 *   makes `markIssueResolved` work between screens.
 * - On duplicate `(severity, description)` pairs the n-th occurrence gets a
 *   `_n` suffix so React keys stay unique without losing determinism.
 *
 * The `credentials` argument is only consulted when `withProposals` is on.
 */
export function parseFeasibilityToHealthResult(
  raw: FeasibilityResult,
  persona: Persona,
  credentials: Array<{ id: string; service_type: string }>,
  options: ParseFeasibilityOptions = {},
): DryRunResult {
  const { withProposals = true } = options;
  // Shape-guard the IPC boundary: filter out non-string / null entries so a
  // backend change or transport glitch can't crash the health panel or
  // render "[object Object]".
  const rawIssues = Array.isArray(raw.issues) ? raw.issues : [];
  const issues: DryRunIssue[] = [];
  // If the same (severity, description) appears more than once, suffix the
  // hashed ID with `_n` in arrival order. Deterministic across runs as long
  // as duplicate count + ordering are stable, while still avoiding React
  // duplicate-key warnings.
  const idCounts = new Map<string, number>();
  for (const entry of rawIssues as unknown[]) {
    const text = coerceIssueText(entry);
    if (!text) continue;
    const severity = inferIssueSeverity(text, raw.overall);
    const baseId = makeIssueId(persona.id, severity, text);
    const seen = idCounts.get(baseId) ?? 0;
    idCounts.set(baseId, seen + 1);
    issues.push({
      id: seen === 0 ? baseId : `${baseId}_${seen}`,
      severity,
      description: text,
      proposal: withProposals ? generateHealthProposal(text, persona, credentials) : null,
      resolved: false,
    });
  }

  return {
    status: mapOverallStatus(raw.overall),
    capabilities: raw.confirmed_capabilities,
    issues,
  };
}

// -- Hook return type -------------------------------------------------

export interface UseHealthCheckReturn {
  phase: 'idle' | 'running' | 'done' | 'error';
  result: PersonaHealthCheck | null;
  score: HealthScore | null;
  error: string | null;
  runHealthCheck: (persona: Persona) => Promise<PersonaHealthCheck | null>;
  markIssueResolved: (issueId: string) => void;
  reset: () => void;
}

// -- Hook -------------------------------------------------------------

export function useHealthCheck(): UseHealthCheckReturn {
  const [phase, setPhase] = useState<UseHealthCheckReturn['phase']>('idle');
  const [result, setResult] = useState<PersonaHealthCheck | null>(null);
  const score = useMemo(() => result ? computeHealthScore(result.result.issues) : null, [result]);
  const [error, setError] = useState<string | null>(null);
  const genRef = useRef(0);

  // A verdict belongs to the persona it was computed for. Both consumers (the
  // editor HealthBadge and the Arena herald) sit inside a component tree that is
  // NOT keyed by persona — PersonasPage renders one <PersonaEditor/> for every
  // selected id — so switching from agent A to agent B used to keep painting
  // A's "degraded · 65" under B's name until someone pressed Run again. The
  // hook remembers which persona it last checked and presents `idle` whenever
  // the app's selected persona is a different one; a stale in-flight run for A
  // that resolves after the switch lands in state but is never shown.
  const [checkedPersonaId, setCheckedPersonaId] = useState<string | null>(null);
  const selectedPersonaId = useAgentStore((s) => s.selectedPersona?.id ?? null);
  const staleForSelection =
    checkedPersonaId !== null && selectedPersonaId !== null && selectedPersonaId !== checkedPersonaId;

  const runHealthCheck = useCallback(async (persona: Persona): Promise<PersonaHealthCheck | null> => {
    const gen = ++genRef.current;
    setCheckedPersonaId(persona.id);
    setPhase('running');
    setResult(null);
    setError(null);

    try {
      const json = JSON.stringify(personaToDesignContext(persona));

      if (gen !== genRef.current) return null;

      const raw = await testDesignFeasibility(json);

      if (gen !== genRef.current) return null;

      const creds = useVaultStore.getState().credentials;
      const credentials = creds.map((c) => ({ id: c.id, service_type: c.service_type }));

      const dryRunResult = parseFeasibilityToHealthResult(raw, persona, credentials);

      // Fetch config warnings (chain trigger parse failures, tool kind ambiguity).
      // Don't fail the whole health check on backend error, but DO surface the
      // failure: route to Sentry via silentCatch and add an `undetermined`
      // issue so the user knows the score doesn't include config-warning
      // coverage. It is `undetermined`, not `info`: the config-warning door
      // being unreachable is a fact about this check, not about the persona,
      // and charging the persona an info penalty for it makes the prober's own
      // outage read as a slightly worse agent.
      const configWarnings = await getPersonaConfigWarnings(persona.id).catch((err) => {
        silentCatch('useHealthCheck:configWarnings')(err);
        const fallbackText = getActiveTranslations().agents.health_check.config_warnings_unavailable;
        dryRunResult.issues.push({
          id: makeIssueId(persona.id, 'undetermined', fallbackText),
          severity: 'undetermined',
          description: fallbackText,
          proposal: null,
          resolved: false,
        });
        return null;
      });
      if (configWarnings && configWarnings.length > 0) {
        for (const w of configWarnings) {
          dryRunResult.issues.push({
            id: `cfg_${w.id}`,
            severity: validateSeverity(w.severity),
            description: w.description,
            proposal: null,
            resolved: false,
          });
        }
        // Downgrade status if we found config warnings
        if (dryRunResult.status === 'ready') {
          dryRunResult.status = 'partial';
        }
      }

      const check: PersonaHealthCheck = {
        personaId: persona.id,
        personaName: persona.name,
        personaIcon: persona.icon,
        personaColor: persona.color,
        result: dryRunResult,
        checkedAt: new Date().toISOString(),
      };

      if (gen !== genRef.current) return null;

      setResult(check);
      setPhase('done');
      return check;
    } catch (err) {
      // The failure reaches the UI as `phase: 'error'`, but the editor badge
      // renders that state identically to "never checked" (it paints score or
      // nothing), so without a breadcrumb the only evidence that the feasibility
      // door threw was a user who noticed the badge never changed.
      silentCatch('useHealthCheck:run')(err);
      if (gen !== genRef.current) return null;
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setPhase('error');
      return null;
    }
  }, []);

  const markIssueResolved = useCallback((issueId: string) => {
    setResult((prev) => {
      if (!prev) return prev;
      const updated = {
        ...prev,
        result: {
          ...prev.result,
          issues: prev.result.issues.map((i: DryRunIssue) => (i.id === issueId ? { ...i, resolved: true } : i)),
        },
      };
      return updated;
    });
  }, []);

  const reset = useCallback(() => {
    genRef.current++;
    setCheckedPersonaId(null);
    setPhase('idle');
    setResult(null);
    setError(null);
  }, []);

  if (staleForSelection) {
    return { phase: 'idle', result: null, score: null, error: null, runHealthCheck, markIssueResolved, reset };
  }
  return { phase, result, score, error, runHealthCheck, markIssueResolved, reset };
}
