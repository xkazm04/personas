import { useCallback, useEffect, useRef, useState } from 'react';
import type { DryRunReport } from '@/lib/bindings/DryRunReport';
import { dryRunPersona } from '@/api/agents/executions';
import { resolveError } from '@/lib/errors/errorRegistry';
import { extractMessage } from '@/lib/silentCatch';

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

  const clearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (clearTimerRef.current) clearTimeout(clearTimerRef.current); }, []);

  const run = useCallback(async () => {
    if (!personaId) return;
    // A pending close-cleanup must not wipe this newer run's result.
    if (clearTimerRef.current) { clearTimeout(clearTimerRef.current); clearTimerRef.current = null; }
    setOpen(true);
    setLoading(true);
    setReport(null);
    setErrorMessage(null);
    try {
      const inputData = getInputData?.()?.trim() || undefined;
      const result = await dryRunPersona(personaId, inputData, useCaseId);
      setReport(result);
    } catch (e) {
      const raw = extractMessage(e);
      setErrorMessage(resolveError(raw).message);
    } finally {
      setLoading(false);
    }
  }, [personaId, getInputData, useCaseId]);

  const close = useCallback(() => {
    setOpen(false);
    // Defer cleanup so the close animation has data to render
    clearTimerRef.current = setTimeout(() => {
      clearTimerRef.current = null;
      setReport(null);
      setErrorMessage(null);
    }, 200);
  }, []);

  return { open, loading, report, errorMessage, run, close };
}
