import { useState, useCallback, useRef, useMemo } from 'react';
import { testDesignFeasibility, type FeasibilityResult } from '@/api/templates/design';
import { useVaultStore } from "@/stores/vaultStore";
import { parseJsonOrDefault } from '@/lib/utils/parseJson';
import { invokeWithTimeout } from '@/lib/tauriInvoke';
import { silentCatch } from '@/lib/silentCatch';
import type { Persona } from '@/lib/bindings/Persona';
import type { DesignContextData } from '@/lib/types/frontendTypes';
import type { DryRunResult, DryRunIssue, PersonaHealthCheck, HealthScore, HealthGrade } from './types';
import { inferIssueSeverity } from '@/lib/errorTaxonomy';

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
 *   bands surfaced in HealthScoreDisplay (healthy / degraded / unhealthy).
 */
export const HEALTH_SCORING = {
  errorPenalty: 25,
  warningPenalty: 10,
  infoPenalty: 2,
  maxScore: 100,
  minScore: 0,
  /** Scores >= this are "healthy". */
  degradedCutoff: 80,
  /** Scores < this are "unhealthy"; between unhealthyCutoff and degradedCutoff is "degraded". */
  unhealthyCutoff: 50,
} as const;

interface ConfigWarning {
  id: string;
  severity: string;
  category: string;
  description: string;
}

const VALID_SEVERITIES: ReadonlySet<DryRunIssue['severity']> = new Set(['error', 'warning', 'info']);

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

function personaToDesignContext(persona: Persona): DesignContextData | null {
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
 * Generate a collision-free issue ID. Uses `crypto.randomUUID()` when
 * available (Electron/Tauri webviews expose it); falls back to a
 * high-entropy `Math.random()` suffix so module re-evaluation (HMR, tests)
 * cannot produce React key collisions with previously rendered issues.
 */
function makeIssueId(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (g.crypto?.randomUUID) {
    return `hc_${g.crypto.randomUUID()}`;
  }
  return `hc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/** @see {@link inferIssueSeverity} — unified implementation in errorTaxonomy */
const inferSeverity = inferIssueSeverity;

function mapOverallStatus(overall: string): DryRunResult['status'] {
  const o = overall.toLowerCase();
  if (o.includes('ready') || o.includes('pass') || o.includes('success')) return 'ready';
  if (o.includes('block') || o.includes('fail')) return 'blocked';
  return 'partial';
}

function generateHealthProposal(
  issueText: string,
  persona: Persona,
  credentials: Array<{ id: string; service_type: string }>,
): DryRunIssue['proposal'] {
  const lower = issueText.toLowerCase();

  // Credential issues
  if (lower.includes('credential') || lower.includes('auth')) {
    const ctx = parseJsonOrDefault<DesignContextData | null>(persona.design_context, null);
    if (ctx?.credentialLinks) {
      // Find unlinked connectors
      const unlinked = Object.entries(ctx.credentialLinks).filter(([, credId]) => !credId);
      if (unlinked.length > 0) {
        const connector = unlinked[0]![0];
        const match = credentials.find((c) => c.service_type === connector);
        if (match) {
          return {
            label: `Link ${connector} credential`,
            actions: [{ type: 'UPDATE_COMPONENT_CREDENTIAL', payload: { componentId: connector, credentialId: match.id } }],
          };
        }
      }
    }
    if (credentials.length > 0) {
      return {
        label: 'Auto-match all credentials',
        actions: [{ type: 'AUTO_MATCH_CREDENTIALS', payload: { credentials } }],
      };
    }
  }

  // Trigger / schedule issues
  if (lower.includes('schedule') || lower.includes('trigger') || lower.includes('cron')) {
    return {
      label: 'Add daily 9 AM schedule',
      actions: [{ type: 'SET_GLOBAL_TRIGGER', payload: { label: 'Daily 9 AM', type: 'schedule', cron: '0 9 * * *' } }],
    };
  }

  // Error handling
  if (lower.includes('error handling') || lower.includes('error strategy') || lower.includes('retry')) {
    return {
      label: 'Switch to retry-3x',
      actions: [{ type: 'SET_ERROR_STRATEGY', payload: 'retry-3x' }],
    };
  }

  // Use case
  if (lower.includes('use case') || lower.includes('usecase') || lower.includes('workflow')) {
    return {
      label: 'Add default use case',
      actions: [{
        type: 'ADD_USE_CASE_WITH_DATA',
        payload: { title: 'Primary Automation', description: 'Core workflow for this agent', category: 'automation' },
      }],
    };
  }

  // Review / approval
  if (lower.includes('review') || lower.includes('approval') || lower.includes('human')) {
    return {
      label: 'Enable first-run review',
      actions: [{ type: 'SET_REVIEW_POLICY', payload: 'on-first-run' }],
    };
  }

  return null;
}

/**
 * Coerce a single raw issue entry to a display string. The IPC contract
 * declares `string[]`, but the backend could evolve (richer objects) or a
 * transport glitch could insert null/undefined. Accept strings directly,
 * extract a `description`/`message`/`text` field from object shapes, and
 * drop anything that can't be rendered without becoming "[object Object]".
 */
function coerceIssueText(raw: unknown): string | null {
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

function parseFeasibilityToHealthResult(
  raw: FeasibilityResult,
  persona: Persona,
  credentials: Array<{ id: string; service_type: string }>,
): DryRunResult {
  // Shape-guard the IPC boundary: filter out non-string / null entries so a
  // backend change or transport glitch can't crash the health panel or
  // render "[object Object]".
  const rawIssues = Array.isArray(raw.issues) ? raw.issues : [];
  const issues: DryRunIssue[] = [];
  for (const entry of rawIssues as unknown[]) {
    const text = coerceIssueText(entry);
    if (!text) continue;
    issues.push({
      id: makeIssueId(),
      severity: inferSeverity(text, raw.overall),
      description: text,
      proposal: generateHealthProposal(text, persona, credentials),
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

  const runHealthCheck = useCallback(async (persona: Persona): Promise<PersonaHealthCheck | null> => {
    const gen = ++genRef.current;
    setPhase('running');
    setResult(null);
    setError(null);

    try {
      const ctx = personaToDesignContext(persona);
      if (!ctx) {
        setError('No design context available for this persona');
        setPhase('error');
        return null;
      }

      const json = JSON.stringify(ctx);

      if (gen !== genRef.current) return null;

      const raw = await testDesignFeasibility(json);

      if (gen !== genRef.current) return null;

      const creds = useVaultStore.getState().credentials;
      const credentials = creds.map((c) => ({ id: c.id, service_type: c.service_type }));

      const dryRunResult = parseFeasibilityToHealthResult(raw, persona, credentials);

      // Fetch config warnings (chain trigger parse failures, tool kind ambiguity).
      // Don't fail the whole health check on backend error, but DO surface the
      // failure: route to Sentry via silentCatch and add an info-severity issue
      // so the user knows the score doesn't include config-warning coverage.
      const configWarnings = await invokeWithTimeout<ConfigWarning[]>(
        'get_persona_config_warnings',
        { personaId: persona.id },
      ).catch((err) => {
        silentCatch('useHealthCheck:configWarnings')(err);
        dryRunResult.issues.push({
          id: makeIssueId(),
          severity: 'info',
          description: 'Could not fetch config warnings — health check may be incomplete.',
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
    setPhase('idle');
    setResult(null);
    setError(null);
  }, []);

  return { phase, result, score, error, runHealthCheck, markIssueResolved, reset };
}
