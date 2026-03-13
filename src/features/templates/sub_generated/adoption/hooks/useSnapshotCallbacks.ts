/**
 * Snapshot polling callbacks for useAsyncTransform.
 * Handles background snapshot events: lines, phase, draft, failure, session loss, and questions.
 */
import { useCallback } from 'react';
import { useBackgroundSnapshot } from '@/hooks/utility/data/useBackgroundSnapshot';
import { getTemplateAdoptSnapshot } from '@/api/templates/templateAdopt';
import { useSystemStore } from "@/stores/systemStore";
import { normalizeDraft } from '@/features/templates/sub_n8n/hooks/n8nTypes';
import { sendOsNotification } from '@/lib/utils/platform/osNotification';
import type { N8nPersonaDraft } from '@/api/templates/n8nTransform';
import type { WizardActions } from '../state/asyncTransformTypes';
import { clearPersistedContext } from '../state/asyncTransformTypes';

interface UseSnapshotCallbacksOptions {
  backgroundAdoptId: string | null;
  wizard: WizardActions;
  setStreamLines: (lines: string[]) => void;
  setStreamPhase: (phase: 'running' | 'completed' | 'failed') => void;
  setIsRestoring: (v: boolean) => void;
}

export function useSnapshotCallbacks({
  backgroundAdoptId,
  wizard,
  setStreamLines,
  setStreamPhase,
  setIsRestoring,
}: UseSnapshotCallbacksOptions) {
  const setTemplateAdoptActive = useSystemStore((s) => s.setTemplateAdoptActive);

  const handleSnapshotLines = useCallback(
    (lines: string[]) => {
      wizard.transformLines(lines);
      setStreamLines(lines);
    },
    [wizard.transformLines, setStreamLines],
  );

  const handleSnapshotPhase = useCallback(
    (phase: 'running' | 'completed' | 'failed') => {
      wizard.transformPhase(phase);
      setStreamPhase(phase);
    },
    [wizard.transformPhase, setStreamPhase],
  );

  const handleSnapshotDraft = useCallback(
    (draft: N8nPersonaDraft) => {
      try {
        wizard.transformCompleted(normalizeDraft(draft));
        void sendOsNotification('Persona Ready', 'Your persona has been built and is ready for review.');
      } catch (err) {
        clearPersistedContext();
        wizard.transformFailed(
          err instanceof Error
            ? `Draft normalization failed: ${err.message}`
            : 'Draft normalization failed. Please retry adoption.',
        );
      }
      setIsRestoring(false);
      setTemplateAdoptActive(false);
    },
    [wizard.transformCompleted, wizard.transformFailed, setTemplateAdoptActive, setIsRestoring],
  );

  const handleSnapshotCompletedNoDraft = useCallback(() => {
    setIsRestoring(false);
    setTemplateAdoptActive(false);
    clearPersistedContext();
    wizard.transformFailed('Transform completed but no draft was generated. Please try again.');
  }, [wizard.transformFailed, setTemplateAdoptActive, setIsRestoring]);

  const handleSnapshotFailed = useCallback(
    (error: string) => {
      setIsRestoring(false);
      setTemplateAdoptActive(false);
      clearPersistedContext();
      wizard.transformFailed(error);
    },
    [wizard.transformFailed, setTemplateAdoptActive, setIsRestoring],
  );

  const handleSnapshotSessionLost = useCallback(() => {
    setIsRestoring(false);
    setTemplateAdoptActive(false);
    clearPersistedContext();
    wizard.transformFailed('Adoption session lost. The backend may have restarted. Please try again.');
  }, [wizard.transformFailed, setTemplateAdoptActive, setIsRestoring]);

  const handleSnapshotQuestions = useCallback(
    (questions: unknown[]) => {
      const mapped = questions
        .filter((q): q is Record<string, unknown> => !!q && typeof q === 'object')
        .map((q) => ({
          id: String(q.id ?? ''),
          question: String(q.question ?? ''),
          type: (q.type === 'select' || q.type === 'text' || q.type === 'boolean' ? q.type : 'text') as 'select' | 'text' | 'boolean',
          options: Array.isArray(q.options) ? q.options.map(String) : undefined,
          default: typeof q.default === 'string' ? q.default : undefined,
          context: typeof q.context === 'string' ? q.context : undefined,
          category: typeof q.category === 'string' ? q.category : undefined,
        }));
      // Use awaitingAnswers to transition to tune step and pause the transform
      if (mapped.length > 0) wizard.awaitingAnswers(mapped);
    },
    [wizard.awaitingAnswers],
  );

  useBackgroundSnapshot({
    snapshotId: backgroundAdoptId,
    getSnapshot: getTemplateAdoptSnapshot,
    onLines: handleSnapshotLines,
    onPhase: handleSnapshotPhase,
    onDraft: handleSnapshotDraft,
    onCompletedNoDraft: handleSnapshotCompletedNoDraft,
    onFailed: handleSnapshotFailed,
    onSessionLost: handleSnapshotSessionLost,
    onQuestions: handleSnapshotQuestions,
  });
}
