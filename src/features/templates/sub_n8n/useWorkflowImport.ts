import { useCallback } from 'react';
import { parseWorkflowFile } from '@/lib/personas/workflowParser';
import { isSupportedFile } from '@/lib/personas/workflowDetector';
import type { N8nImportAction } from './useN8nImportReducer';

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;

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
  const processContent = useCallback(
    (content: string, sourceName: string) => {
      try {
        if (!content || content.trim().length === 0) {
          dispatch({ type: 'SET_ERROR', error: 'Content is empty.' });
          return;
        }

        let parseResult;
        try {
          parseResult = parseWorkflowFile(content, sourceName);
        } catch (parseErr) {
          dispatch({
            type: 'SET_ERROR',
            error: `Failed to analyze workflow: ${parseErr instanceof Error ? parseErr.message : 'unknown error'}`,
          });
          return;
        }

<<<<<<< HEAD
        const { detection, result, workflowName: wfName, rawJson, needsConfirmation } = parseResult;
=======
        const { detection, result, workflowName: wfName, rawJson } = parseResult;
>>>>>>> 4922a97724aa56b26b532cfa6695776f4c697989

        void Promise.resolve(removeSession()).catch(() => {});
        clearPersistedContext();
        void resetTransformStream();
        setIsRestoring(false);

        dispatch({
          type: 'FILE_PARSED',
          workflowName: wfName,
          rawWorkflowJson: rawJson,
          parsedResult: result,
          platform: detection.platform,
<<<<<<< HEAD
          needsConfirmation,
          detectedConfidence: detection.confidence,
=======
>>>>>>> 4922a97724aa56b26b532cfa6695776f4c697989
        });

        void Promise.resolve(createSession(wfName, rawJson)).catch(() => {});
      } catch (err) {
        dispatch({
          type: 'SET_ERROR',
          error: err instanceof Error ? err.message : 'Failed to parse workflow content.',
        });
      }
    },
    [dispatch, removeSession, clearPersistedContext, resetTransformStream, setIsRestoring, createSession],
  );

  const processFile = useCallback(
    (file: File) => {
      try {
        if (!isSupportedFile(file.name)) {
          dispatch({ type: 'SET_ERROR', error: 'Unsupported file type. Accepts .json (n8n, Zapier, Make) or .yml/.yaml (GitHub Actions).' });
          return;
        }

        if (file.size > MAX_FILE_SIZE_BYTES) {
          dispatch({ type: 'SET_ERROR', error: 'File is too large (max 5MB). Please use a smaller workflow export.' });
          return;
        }

        const reader = new FileReader();
        reader.onload = (e) => {
          const content = e.target?.result as string;
          processContent(content, file.name);
        };
        reader.onerror = () => dispatch({ type: 'SET_ERROR', error: 'Failed to read the file.' });
        reader.readAsText(file);
      } catch (err) {
        dispatch({
          type: 'SET_ERROR',
          error: `Unexpected error: ${err instanceof Error ? err.message : 'unknown error'}`,
        });
      }
    },
    [dispatch, processContent],
  );

  return { processContent, processFile };
}
