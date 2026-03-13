import { useState, useCallback, useRef, useMemo } from 'react';
import { testDesignFeasibility, type FeasibilityResult } from '@/api/templates/design';
import { useVaultStore } from "@/stores/vaultStore";
import { parseJsonOrDefault } from '@/lib/utils/parseJson';
import type { Persona } from '@/lib/bindings/Persona';
import type { DesignContextData } from '@/lib/types/frontendTypes';
import type { DryRunResult, DryRunIssue, PersonaHealthCheck, HealthScore, HealthGrade } from './types';

// -- Scoring helpers --------------------------------------------------

export function computeHealthScore(issues: DryRunIssue[]): HealthScore {
  const unresolved = issues.filter((i) => !i.resolved);
  const errors = unresolved.filter((i) => i.severity === 'error').length;
  const warnings = unresolved.filter((i) => i.severity === 'warning').length;
  const infos = unresolved.filter((i) => i.severity === 'info').length;

  // Deduct: 25 per error, 10 per warning, 2 per info
  const penalty = errors * 25 + warnings * 10 + infos * 2;
  const value = Math.max(0, Math.min(100, 100 - penalty));

  let grade: HealthGrade = 'healthy';
  if (value < 50) grade = 'unhealthy';
  else if (value < 80) grade = 'degraded';

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

let issueSeq = 1;

function inferSeverity(issueText: string, overall: string): DryRunIssue['severity'] {
  const lower = issueText.toLowerCase();
  if (overall === 'blocked' || lower.includes('missing') || lower.includes('required') || lower.includes('must')) {
    return 'error';
  }
  if (lower.includes('recommend') || lower.includes('consider') || lower.includes('optional') || lower.includes('suggest')) {
    return 'info';
  }
  return 'warning';
}

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

function parseFeasibilityToHealthResult(
  raw: FeasibilityResult,
  persona: Persona,
  credentials: Array<{ id: string; service_type: string }>,
): DryRunResult {
  const issues: DryRunIssue[] = raw.issues.map((text) => ({
    id: `hc_${Date.now()}_${issueSeq++}`,
    severity: inferSeverity(text, raw.overall),
    description: text,
    proposal: generateHealthProposal(text, persona, credentials),
    resolved: false,
  }));

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
