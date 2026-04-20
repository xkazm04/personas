import { silentCatch, toastCatch } from "@/lib/silentCatch";
import { useCallback, useEffect, MutableRefObject } from 'react';
import { listen } from '@tauri-apps/api/event';
import { EventName } from '@/lib/eventRegistry';
import type { N8nPersonaDraft } from '@/api/templates/n8nTransform';
import { getTemplateGenerateSnapshot } from '@/api/templates/templateAdopt';
import { normalizeDraftFromUnknown } from '@/features/templates/sub_n8n/hooks/n8nTypes';
import { useBackgroundSnapshot } from '@/hooks/utility/data/useBackgroundSnapshot';
import { clearPersistedContext } from './modals/createTemplateTypes';
import type { useCreateTemplateReducer } from './useCreateTemplateReducer';
import * as Sentry from '@sentry/react';

/**
 * Max length of `result_json` content to attach to Sentry captures.
 * 500 is enough to distinguish malformed-JSON shapes without turning every
 * capture into a PII firehose.
 */
const RESULT_JSON_CAPTURE_LIMIT = 500;

/**
 * Best-effort scrub of secret-looking fragments before sending JSON samples
 * to Sentry. Not a substitute for server-side redaction — we already limit
 * to 500 chars, but this blunts the obvious `"api_key":"sk-..."` cases.
 */
function scrubSecrets(input: string): string {
  return input
    .replace(/"(?:api_key|password|secret|token|authorization)"\s*:\s*"[^"]*"/gi, '"$1":"[redacted]"')
    .replace(/sk-[A-Za-z0-9_-]{10,}/g, 'sk-[redacted]');
}

/**
 * Report a JSON parse failure during snapshot handling. Surfaces a friendly
 * toast so the user isn't stuck on "completed with no result", and captures
 * a scrubbed excerpt to Sentry tagged with the template id for triage.
 */
function reportSnapshotParseFailure(
  context: string,
  err: unknown,
  rawJson: string | null | undefined,
  templateId: string | null,
): void {
  const excerpt = rawJson ? scrubSecrets(rawJson.slice(0, RESULT_JSON_CAPTURE_LIMIT)) : null;
  try {
    Sentry.withScope((scope) => {
      scope.setTag('context', context);
      if (templateId) scope.setTag('templateId', templateId);
      if (excerpt) scope.setExtra('result_json_excerpt', excerpt);
      scope.setExtra('result_json_length', rawJson?.length ?? 0);
      Sentry.captureException(err instanceof Error ? err : new Error(String(err)));
    });
  } catch { /* intentional: Sentry may be uninitialized */ }
  toastCatch(
    context,
    'Generation finished but the result was malformed. Please retry.',
  )(err);
}

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
      } catch (err) {
        // Surface the parse failure instead of silently swallowing it — a
        // backend that corrupts its own JSON is never self-healing, and
        // "completed with no result" was indistinguishable from a slow run.
        reportSnapshotParseFailure(
          'useCreateTemplateSnapshot:snapshotGetFn',
          err,
          snap.result_json,
          id,
        );
      }
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
    let failureReason = 'Generation completed but no valid persona draft was found.';
    if (genIdRef.current) {
      const templateId = genIdRef.current;
      try {
        const snap = await getTemplateGenerateSnapshot(templateId);
        if (snap.result_json) {
          try {
            const parsed = JSON.parse(snap.result_json);
            const draft = normalizeDraftFromUnknown(parsed?.persona ?? parsed);
            if (draft) {
              reducer.generateCompleted(draft, snap.result_json);
              clearPersistedContext();
              return;
            }
          } catch (parseErr) {
            reportSnapshotParseFailure(
              'useCreateTemplateSnapshot:onSnapshotCompletedNoDraft',
              parseErr,
              snap.result_json,
              templateId,
            );
            failureReason = 'Generation finished but the result was malformed. Please retry.';
          }
        }
      } catch (err) {
        silentCatch('useCreateTemplateSnapshot:onSnapshotCompletedNoDraft:refetch')(err);
      }
    }
    reducer.generateFailed(failureReason);
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
