import { silentCatch } from "@/lib/silentCatch";
import { useCallback, useEffect, MutableRefObject } from 'react';
import { listen } from '@tauri-apps/api/event';
import { EventName } from '@/lib/eventRegistry';
import type { N8nPersonaDraft } from '@/api/templates/n8nTransform';
import { getTemplateGenerateSnapshot } from '@/api/templates/templateAdopt';
import { normalizeDraftFromUnknown } from '@/features/templates/sub_n8n/hooks/n8nTypes';
import { useBackgroundSnapshot } from '@/hooks/utility/data/useBackgroundSnapshot';
import { clearPersistedContext } from './modals/createTemplateTypes';
import type { useCreateTemplateReducer } from './useCreateTemplateReducer';

export function useCreateTemplateSnapshot(
  reducer: ReturnType<typeof useCreateTemplateReducer>,
  backgroundGenId: string | null,
  genIdRef: MutableRefObject<string | null>,
) {
  const snapshotGetFn = useCallback(async (id: string) => {
    const snap = await getTemplateGenerateSnapshot(id);
    let draft: N8nPersonaDraft | null = null;
    if (snap.status === 'completed' && snap.result_json) {
      try {
        const parsed = JSON.parse(snap.result_json);
        draft = normalizeDraftFromUnknown(parsed?.persona ?? parsed);
      } catch { /* intentional: non-critical -- JSON parse fallback */ }
    }
    return {
      status: snap.status as 'idle' | 'running' | 'completed' | 'failed',
      error: snap.error,
      lines: snap.lines,
      draft,
    };
  }, []);

  const onSnapshotLines = useCallback((lines: string[]) => {
    reducer.generateLines(lines);
  }, [reducer]);

  const onSnapshotPhase = useCallback((phase: 'running' | 'completed' | 'failed') => {
    reducer.generatePhase(phase);
  }, [reducer]);

  const onSnapshotDraft = useCallback((draft: N8nPersonaDraft) => {
    reducer.generateCompleted(draft, '');
    clearPersistedContext();
  }, [reducer]);

  const onSnapshotCompletedNoDraft = useCallback(async () => {
    if (genIdRef.current) {
      try {
        const snap = await getTemplateGenerateSnapshot(genIdRef.current);
        if (snap.result_json) {
          const parsed = JSON.parse(snap.result_json);
          const draft = normalizeDraftFromUnknown(parsed?.persona ?? parsed);
          if (draft) {
            reducer.generateCompleted(draft, snap.result_json);
            clearPersistedContext();
            return;
          }
        }
      } catch { /* intentional: non-critical -- JSON parse fallback */ }
    }
    reducer.generateFailed('Generation completed but no valid persona draft was found.');
    clearPersistedContext();
  }, [reducer, genIdRef]);

  const onSnapshotFailed = useCallback((error: string) => {
    reducer.generateFailed(error);
    clearPersistedContext();
  }, [reducer]);

  const onSnapshotSessionLost = useCallback(() => {
    reducer.generateFailed('Lost connection to background generation job.');
    clearPersistedContext();
  }, [reducer]);

  useBackgroundSnapshot({
    snapshotId: backgroundGenId,
    getSnapshot: snapshotGetFn,
    onLines: onSnapshotLines,
    onPhase: onSnapshotPhase,
    onDraft: onSnapshotDraft,
    onCompletedNoDraft: onSnapshotCompletedNoDraft,
    onFailed: onSnapshotFailed,
    onSessionLost: onSnapshotSessionLost,
    interval: 1500,
  });

  // -- Event listeners for streaming lines --
  useEffect(() => {
    if (!backgroundGenId) return;
    const currentGenId = backgroundGenId;

    const unlistenPromise = listen<{ gen_id: string; line: string }>(
      EventName.TEMPLATE_GENERATE_OUTPUT,
      (event) => {
        if (event.payload.gen_id === currentGenId) {
          reducer.appendGenerateLine(event.payload.line);
        }
      },
    );

    return () => {
      unlistenPromise.then((unlisten) => unlisten()).catch(silentCatch("useCreateTemplateSnapshot:unlisten"));
    };
  }, [backgroundGenId, reducer.appendGenerateLine]);
}
