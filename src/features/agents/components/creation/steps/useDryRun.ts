import { useState, useCallback, useRef } from 'react';
import type { BuilderState, DryRunResult, DryRunIssue, DryRunProposal } from './types';
import { toDesignContext } from './builderReducer';
import { testDesignFeasibility, type FeasibilityResult } from '@/api/templates/design';
import { usePersonaStore } from '@/stores/personaStore';

// ── Public interface ────────────────────────────────────────────────

export interface UseDryRunReturn {
  phase: 'idle' | 'running' | 'done' | 'error';
  outputLines: string[];
  result: DryRunResult | null;
  error: string | null;
  runTest: (state: BuilderState) => Promise<void>;
  markIssueResolved: (issueId: string) => void;
  reset: () => void;
}

// ── Proposal generation ─────────────────────────────────────────────

let issueSeq = 1;

function generateProposal(
  issueText: string,
  state: BuilderState,
  credentials: Array<{ id: string; service_type: string }>,
): DryRunProposal | null {
  const lower = issueText.toLowerCase();

  // Schedule / trigger
  if (lower.includes('schedule') || lower.includes('trigger') || lower.includes('cron')) {
    if (!state.globalTrigger) {
      return {
        label: 'Add daily 9 AM schedule',
        actions: [{ type: 'SET_GLOBAL_TRIGGER', payload: { label: 'Daily 9 AM', type: 'schedule', cron: '0 9 * * *' } }],
      };
    }
  }

  // Error handling
  if (lower.includes('error handling') || lower.includes('error strategy') || lower.includes('retry')) {
    if (state.errorStrategy === 'halt') {
      return {
        label: 'Switch to retry-3x',
        actions: [{ type: 'SET_ERROR_STRATEGY', payload: 'retry-3x' }],
      };
    }
  }

  // Credential for specific connector
  if (lower.includes('credential')) {
    // Try to find a specific connector mentioned in the issue
    for (const comp of state.components) {
      if (lower.includes(comp.connectorName.toLowerCase()) && !comp.credentialId) {
        const match = credentials.find((c) => c.service_type === comp.connectorName);
        if (match) {
          return {
            label: `Link ${comp.connectorName} credential`,
            actions: [{ type: 'UPDATE_COMPONENT_CREDENTIAL', payload: { componentId: comp.id, credentialId: match.id } }],
          };
        }
      }
    }
    // Generic credential matching
    const unmatched = state.components.filter((c) => !c.credentialId && c.connectorName !== 'in-app-messaging' && c.connectorName !== 'http');
    if (unmatched.length > 0 && credentials.length > 0) {
      return {
        label: 'Auto-match all credentials',
        actions: [{ type: 'AUTO_MATCH_CREDENTIALS', payload: { credentials } }],
      };
    }
  }

  // Use case
  if (lower.includes('use case') || lower.includes('usecase') || lower.includes('workflow')) {
    if (state.useCases.length === 0) {
      return {
        label: 'Add default use case',
        actions: [{
          type: 'ADD_USE_CASE_WITH_DATA',
          payload: { title: 'Primary Automation', description: 'Core workflow for this agent', category: 'automation' },
        }],
      };
    }
  }

  // Review / approval
  if (lower.includes('review') || lower.includes('approval') || lower.includes('human')) {
    if (state.reviewPolicy === 'never') {
      return {
        label: 'Enable first-run review',
        actions: [{ type: 'SET_REVIEW_POLICY', payload: 'on-first-run' }],
      };
    }
  }

  return null; // Manual action needed
}

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

function parseFeasibilityResult(
  raw: FeasibilityResult,
  state: BuilderState,
  credentials: Array<{ id: string; service_type: string }>,
): DryRunResult {
  const issues: DryRunIssue[] = raw.issues.map((text) => ({
    id: `issue_${Date.now()}_${issueSeq++}`,
    severity: inferSeverity(text, raw.overall),
    description: text,
    proposal: generateProposal(text, state, credentials),
    resolved: false,
  }));

  return {
    status: mapOverallStatus(raw.overall),
    capabilities: raw.confirmed_capabilities,
    issues,
  };
}

// ── Hook ────────────────────────────────────────────────────────────

export function useDryRun(): UseDryRunReturn {
  const [phase, setPhase] = useState<UseDryRunReturn['phase']>('idle');
  const [outputLines, setOutputLines] = useState<string[]>([]);
  const [result, setResult] = useState<DryRunResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef(false);

  const pushLine = useCallback((line: string) => {
    setOutputLines((prev) => [...prev, line]);
  }, []);

  const runTest = useCallback(async (state: BuilderState) => {
    abortRef.current = false;
    setPhase('running');
    setOutputLines([]);
    setResult(null);
    setError(null);

    try {
      pushLine('> Compiling design context...');
      const ctx = toDesignContext(state);
      const json = JSON.stringify(ctx);

      if (abortRef.current) return;
      pushLine('> Running feasibility analysis...');
      pushLine(`> Context size: ${json.length} bytes`);

      const raw = await testDesignFeasibility(json);

      if (abortRef.current) return;
      pushLine(`> Analysis complete — overall: ${raw.overall}`);
      pushLine(`> ${raw.confirmed_capabilities.length} capabilities confirmed`);
      if (raw.issues.length > 0) {
        pushLine(`> ${raw.issues.length} issue${raw.issues.length !== 1 ? 's' : ''} found`);
      }

      // Get credentials from store for proposal generation
      const creds = usePersonaStore.getState().credentials;
      const credentials = creds.map((c) => ({ id: c.id, service_type: c.service_type }));

      const parsed = parseFeasibilityResult(raw, state, credentials);
      setResult(parsed);
      setPhase('done');
      pushLine('> Done.');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      pushLine(`> Error: ${msg}`);
      setError(msg);
      setPhase('error');
    }
  }, [pushLine]);

  const markIssueResolved = useCallback((issueId: string) => {
    setResult((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        issues: prev.issues.map((i) => (i.id === issueId ? { ...i, resolved: true } : i)),
      };
    });
  }, []);

  const reset = useCallback(() => {
    abortRef.current = true;
    setPhase('idle');
    setOutputLines([]);
    setResult(null);
    setError(null);
  }, []);

  return { phase, outputLines, result, error, runTest, markIssueResolved, reset };
}
