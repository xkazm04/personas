import { useCallback, useState } from 'react';
import type { DryRunReport } from '@/lib/bindings/DryRunReport';
import { dryRunPersona } from '@/api/agents/executions';
import { resolveError } from '@/lib/errors/errorRegistry';

interface UseDryRunOptions {
  personaId: string;
  /** Optional input data (raw string — JSON or plain text). Mirrors execute_persona. */
  getInputData?: () => string | undefined;
  /** Optional use_case_id to scope the dry run to a capability. */
  useCaseId?: string;
}

/**
 * Manages a single in-flight dry run + its result modal.
 *
 * Reuses the runner's Validate-stage logic on the backend to assemble the
 * exact prompt that an execution would send, without spawning the engine
 * subprocess. The hook does not depend on the persona being selected in
 * the store — the caller passes `personaId` directly so this works in both
 * the runner pane and the execution detail modal.
 */
export function useDryRun({ personaId, getInputData, useCaseId }: UseDryRunOptions) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<DryRunReport | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const run = useCallback(async () => {
    if (!personaId) return;
    setOpen(true);
    setLoading(true);
    setReport(null);
    setErrorMessage(null);
    try {
      const inputData = getInputData?.()?.trim() || undefined;
      const result = await dryRunPersona(personaId, inputData, useCaseId);
      setReport(result);
    } catch (e) {
      const raw = e instanceof Error ? e.message : typeof e === 'string' ? e : String(e);
      setErrorMessage(resolveError(raw).message);
    } finally {
      setLoading(false);
    }
  }, [personaId, getInputData, useCaseId]);

  const close = useCallback(() => {
    setOpen(false);
    // Defer cleanup so the close animation has data to render
    setTimeout(() => {
      setReport(null);
      setErrorMessage(null);
    }, 200);
  }, []);

  return { open, loading, report, errorMessage, run, close };
}
