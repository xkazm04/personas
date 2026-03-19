import { useState, useCallback, useRef, useEffect } from 'react';
import { useCorrelatedCliStream } from '@/hooks/execution/useCorrelatedCliStream';
import { testN8nDraft } from '@/api/agents/tests';
import { sendAppNotification } from '@/api/system/system';
import { silentCatch } from "@/lib/silentCatch";
import { useSystemStore } from "@/stores/systemStore";
import type { CliRunPhase } from '@/hooks/execution/useCorrelatedCliStream';

export interface UseBackgroundPreviewReturn {
  phase: CliRunPhase;
  lines: string[];
  error: string | null;
  reviewId: string | null;
  reviewName: string | null;
  isActive: boolean;
  hasStarted: boolean;
  startPreview: (reviewId: string, reviewName: string, draftJson: string) => Promise<void>;
  retryPreview: (draftJson: string) => Promise<void>;
  resetPreview: () => void;
}

export function useBackgroundPreview(): UseBackgroundPreviewReturn {
  const [error, setError] = useState<string | null>(null);
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [reviewName, setReviewName] = useState<string | null>(null);
  const [hasStarted, setHasStarted] = useState(false);
  const lastDraftJsonRef = useRef<string | null>(null);

  const setTemplateTestActive = useSystemStore((s) => s.setTemplateTestActive);

  const stream = useCorrelatedCliStream({
    outputEvent: 'n8n-test-output',
    statusEvent: 'n8n-test-status',
    idField: 'test_id',
    onFailed: (msg) => setError(msg),
  });

  // Send notification on completion/failure
  const prevPhaseRef = useRef<CliRunPhase>('idle');
  useEffect(() => {
    const prev = prevPhaseRef.current;
    prevPhaseRef.current = stream.phase;

    if (prev === 'running' && stream.phase === 'completed') {
      setTemplateTestActive(false);
      sendAppNotification('Preview Complete', `Template test "${reviewName ?? 'template'}" finished.`).catch(silentCatch("backgroundPreview:notifyComplete"));
    } else if (prev === 'running' && stream.phase === 'failed') {
      setTemplateTestActive(false);
      sendAppNotification('Preview Failed', `Template test "${reviewName ?? 'template'}" failed.`).catch(silentCatch("backgroundPreview:notifyFailed"));
    }
  }, [stream.phase, reviewName, setTemplateTestActive]);

  const startPreview = useCallback(async (rId: string, rName: string, draftJson: string) => {
    setError(null);
    setReviewId(rId);
    setReviewName(rName);
    setHasStarted(true);
    lastDraftJsonRef.current = draftJson;
    setTemplateTestActive(true);

    const testId = crypto.randomUUID();
    await stream.start(testId);
    try {
      await testN8nDraft(testId, draftJson);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start preview');
      setTemplateTestActive(false);
    }
  }, [stream, setTemplateTestActive]);

  const retryPreview = useCallback(async (draftJson: string) => {
    await stream.reset();
    setError(null);
    setTemplateTestActive(true);
    lastDraftJsonRef.current = draftJson;

    const testId = crypto.randomUUID();
    setTimeout(async () => {
      await stream.start(testId);
      try {
        await testN8nDraft(testId, draftJson);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to start preview');
        setTemplateTestActive(false);
      }
    }, 50);
  }, [stream, setTemplateTestActive]);

  const resetPreview = useCallback(() => {
    stream.reset();
    setError(null);
    setReviewId(null);
    setReviewName(null);
    setHasStarted(false);
    lastDraftJsonRef.current = null;
    setTemplateTestActive(false);
  }, [stream, setTemplateTestActive]);

  return {
    phase: stream.phase,
    lines: stream.lines,
    error,
    reviewId,
    reviewName,
    isActive: hasStarted && reviewId !== null,
    hasStarted,
    startPreview,
    retryPreview,
    resetPreview,
  };
}
