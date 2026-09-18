import { useState, useMemo, useCallback } from 'react';
import { getExecution } from '@/api/agents/executions';
import { getRetryChain } from '@/api/overview/healing';
import { useToastStore } from '@/stores/toastStore';
import { createLogger } from '@/lib/log';
import type { ExecutionListItem } from '@/lib/bindings/ExecutionListItem';
import type { ExecutionAnnotation } from '@/lib/bindings/ExecutionAnnotation';
import type { PersonaExecution } from '@/lib/bindings/PersonaExecution';

const logger = createLogger('execution-list');

interface CompareMessages {
  failed_to_load_chain: string;
  failed_to_hydrate_comparison: string;
}

/**
 * Two-run comparison state for the persona run ledger: A/B picks, full-record
 * hydration (the list rows are lean), the retry-chain shortcut and the
 * "compare the two most recently starred runs" shortcut.
 */
export function useExecutionCompare(
  personaId: string,
  rows: ExecutionListItem[],
  annotationsByExecution: Map<string, ExecutionAnnotation>,
  msg: CompareMessages,
) {
  const [compareMode, setCompareMode] = useState(false);
  const [compareLeft, setCompareLeft] = useState<string | null>(null);
  const [compareRight, setCompareRight] = useState<string | null>(null);
  const [showComparison, setShowComparison] = useState(false);
  const [details, setDetails] = useState<Record<string, PersonaExecution>>({});

  const hydrate = useCallback(async (executionId: string) => {
    if (details[executionId]) return details[executionId];
    const detail = await getExecution(executionId, personaId);
    setDetails((prev) => ({ ...prev, [executionId]: detail }));
    return detail;
  }, [details, personaId]);

  const fail = useCallback((key: keyof CompareMessages, err: unknown) => {
    logger.warn('Execution comparison failed', { key, error: err });
    useToastStore.getState().addToast(msg[key], 'error');
  }, [msg]);

  /** Put a pair side by side, hydrating both first. */
  const openPair = useCallback(async (left: string, right: string) => {
    setCompareMode(true);
    setCompareLeft(left);
    setCompareRight(right);
    try {
      await Promise.all([hydrate(left), hydrate(right)]);
      setShowComparison(true);
    } catch (err) {
      fail('failed_to_hydrate_comparison', err);
    }
  }, [hydrate, fail]);

  const select = useCallback((executionId: string) => {
    if (!compareLeft) setCompareLeft(executionId);
    else if (!compareRight && executionId !== compareLeft) setCompareRight(executionId);
    else { setCompareLeft(executionId); setCompareRight(null); }
  }, [compareLeft, compareRight]);

  const exit = useCallback(() => {
    setCompareMode(false); setCompareLeft(null); setCompareRight(null); setShowComparison(false);
  }, []);

  const compareRetry = useCallback(async (executionId: string) => {
    if (!personaId) return;
    try {
      const chain = await getRetryChain(executionId, personaId);
      if (chain.length >= 2) {
        setCompareLeft(chain[0]!.id);
        setCompareRight(chain[chain.length - 1]!.id);
        setCompareMode(true);
      }
    } catch (err) {
      fail('failed_to_load_chain', err);
    }
  }, [personaId, fail]);

  // Two most recently starred runs among the loaded rows (annotation updated_at DESC).
  const starredPair = useMemo(() => {
    const starred = rows
      .map((exec) => ({ exec, ann: annotationsByExecution.get(exec.id) }))
      .filter((x) => x.ann?.starred)
      .sort((a, b) => (b.ann!.updated_at ?? '').localeCompare(a.ann!.updated_at ?? ''));
    if (starred.length < 2) return null;
    return [starred[0]!.exec.id, starred[1]!.exec.id] as const;
  }, [rows, annotationsByExecution]);

  const left = compareLeft ? details[compareLeft] ?? null : null;
  const right = compareRight ? details[compareRight] ?? null : null;
  const canCompare = !!compareLeft && !!compareRight && compareLeft !== compareRight;

  return {
    compareMode, setCompareMode, compareLeft, compareRight, showComparison, canCompare,
    left, right, starredPair, hydrate, openPair, select, exit, compareRetry,
  };
}
