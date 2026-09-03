import { useState, useCallback, useRef, useEffect } from 'react';
import { useCorrelatedCliStream } from '@/hooks/execution/useCorrelatedCliStream';
import { EventName } from '@/lib/eventRegistry';
import { testN8nDraft } from '@/api/agents/tests';
import { sendAppNotification } from '@/api/system/system';
import { silentCatch } from "@/lib/silentCatch";
import { useSystemStore } from "@/stores/systemStore";
import { useTranslation } from '@/i18n/useTranslation';
import {
  isCliRunActive,
  isCliRunSettled,
  type CliRunPhase,
} from '@/hooks/execution/useCorrelatedCliStream';

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
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [reviewName, setReviewName] = useState<string | null>(null);
  const [hasStarted, setHasStarted] = useState(false);
  const lastDraftJsonRef = useRef<string | null>(null);

  const setTemplateTestActive = useSystemStore((s) => s.setTemplateTestActive);

  const stream = useCorrelatedCliStream({
    outputEvent: EventName.N8N_TEST_OUTPUT,
    statusEvent: EventName.N8N_TEST_STATUS,
    idField: 'test_id',
    onFailed: (msg) => setError(msg),
  });

  // Notify on ANY settled outcome, not just completed/failed. A cancelled or
  // incomplete run used to leave `templateTestActive` true forever -- the
  // global "a template test is running" flag never cleared, so the app kept
  // claiming a test was in flight until a new one replaced it.
  const prevPhaseRef = useRef<CliRunPhase>('idle');
  useEffect(() => {
    const prev = prevPhaseRef.current;
    prevPhaseRef.current = stream.phase;

    if (!isCliRunActive(prev) || !isCliRunSettled(stream.phase)) return;

    setTemplateTestActive(false);
    const name = reviewName ?? 'template';

    if (stream.phase === 'completed') {
      sendAppNotification('Preview Complete', `Template test "${name}" finished.`).catch(silentCatch("backgroundPreview:notifyComplete"));
    } else if (stream.phase === 'failed') {
      sendAppNotification('Preview Failed', `Template test "${name}" failed.`).catch(silentCatch("backgroundPreview:notifyFailed"));
    } else {
      // Cancelled / incomplete / unknown. The title comes from the app's own
      // status vocabulary rather than an English literal -- an OS notification
      // leaves the app for good, so nothing can re-render it later.
      const title =
        stream.phase === 'cancelled'
          ? t.monitor.status_cancelled
          : t.agents.executions.stopped_while_running;
      sendAppNotification(title, `Template test "${name}"`).catch(silentCatch("backgroundPreview:notifyStopped"));
    }
  }, [stream.phase, reviewName, setTemplateTestActive, t]);

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
