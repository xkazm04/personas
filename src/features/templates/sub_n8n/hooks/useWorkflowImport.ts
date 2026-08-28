import { silentCatch } from "@/lib/silentCatch";
import { useCallback } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { resolveErrorTranslated } from '@/i18n/useTranslatedError';
import { parseWorkflowFile } from '@/lib/personas/parsers/workflowParser';
import { isSupportedFile } from '@/lib/personas/parsers/workflowDetector';
import { MAX_WORKFLOW_JSON_BYTES } from '@/lib/n8nLimits.generated';
import type { N8nImportAction } from './useN8nImportReducer';

const MAX_FILE_SIZE_BYTES = MAX_WORKFLOW_JSON_BYTES;

interface UseWorkflowImportOptions {
  dispatch: React.Dispatch<N8nImportAction>;
  removeSession: () => void | Promise<unknown>;
  clearPersistedContext: () => void;
  resetTransformStream: () => Promise<void>;
  setIsRestoring: (restoring: boolean) => void;
  createSession: (workflowName: string, rawWorkflowJson: string) => void | Promise<unknown>;
}

export function useWorkflowImport({
  dispatch,
  removeSession,
  clearPersistedContext,
  resetTransformStream,
  setIsRestoring,
  createSession,
}: UseWorkflowImportOptions) {
  const { t } = useTranslation();

  /**
   * Every refusal this wizard shows comes from a `.ts` module that throws an
   * English sentence — the parser's ("File is empty.", "Invalid YAML: …",
   * "Could not identify the workflow platform…") and this hook's own guards.
   * They were rendered verbatim, so in a 14-language app the error path was
   * the one surface that never spoke the user's language. The parsers keep
   * their stable strings; the error registry turns them into product copy.
   */
  const fail = useCallback(
    (raw: string) => {
      const { message, suggestion } = resolveErrorTranslated(t, raw);
      dispatch({ type: 'SET_ERROR', error: suggestion ? `${message} ${suggestion}` : message });
    },
    [dispatch, t],
  );

  const processContent = useCallback(
    (content: string, sourceName: string) => {
      try {
        if (!content || content.trim().length === 0) {
          fail('Content is empty.');
          return;
        }

        let parseResult;
        try {
          parseResult = parseWorkflowFile(content, sourceName);
        } catch (parseErr) {
          fail(parseErr instanceof Error ? parseErr.message : '');
          return;
        }

        const { detection, result, workflowName: wfName, rawJson, needsConfirmation } = parseResult;

        void Promise.resolve(removeSession()).catch(silentCatch("useWorkflowImport:removeSession"));
        clearPersistedContext();
        void resetTransformStream();
        setIsRestoring(false);

        dispatch({
          type: 'FILE_PARSED',
          workflowName: wfName,
          rawWorkflowJson: rawJson,
          parsedResult: result,
          platform: detection.platform,
          needsConfirmation,
          detectedConfidence: detection.confidence,
        });

        void Promise.resolve(createSession(wfName, rawJson)).catch(silentCatch("useWorkflowImport:createSession"));
      } catch (err) {
        fail(err instanceof Error ? err.message : '');
      }
    },
    [fail, removeSession, clearPersistedContext, resetTransformStream, setIsRestoring, createSession, dispatch],
  );

  const processFile = useCallback(
    (file: File) => {
      try {
        if (!isSupportedFile(file.name)) {
          fail('Unsupported file type.');
          return;
        }

        if (file.size > MAX_FILE_SIZE_BYTES) {
          fail('File is too large.');
          return;
        }

        const reader = new FileReader();
        reader.onload = (e) => {
          const content = e.target?.result as string;
          processContent(content, file.name);
        };
        reader.onerror = () => fail('Failed to read the file.');
        reader.readAsText(file);
      } catch (err) {
        fail(err instanceof Error ? err.message : '');
      }
    },
    [fail, processContent],
  );

  return { processContent, processFile };
}
