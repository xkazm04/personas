/**
 * Hook for importing workflow files into the matrix build flow.
 *
 * Reuses the platform-agnostic parser infrastructure from
 * src/lib/personas/parsers/ to detect and parse n8n, Zapier, Make,
 * and GitHub Actions workflows. Stores the parsed result in the
 * matrixBuildSlice for consumption by the build session.
 */
import { useCallback, useState } from "react";
import { parseWorkflowFile, type WorkflowParseResult } from "@/lib/personas/parsers/workflowParser";
import { isSupportedFile } from "@/lib/personas/parsers/workflowDetector";
import { useAgentStore } from "@/stores/agentStore";

// Keep in sync with backend: n8n_sessions.rs MAX_WORKFLOW_JSON_BYTES
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

interface UseMatrixWorkflowImportReturn {
  /** Parse a content string (e.g., from paste or URL fetch) */
  processContent: (content: string, fileName: string) => WorkflowParseResult | null;
  /** Parse a File object (from drag-and-drop or file input) */
  processFile: (file: File) => Promise<WorkflowParseResult | null>;
  /** Last parse error, if any */
  importError: string | null;
  /** Clear the error */
  clearImportError: () => void;
}

export function useMatrixWorkflowImport(): UseMatrixWorkflowImportReturn {
  const setWorkflowImport = useAgentStore((s) => s.setWorkflowImport);
  const [importError, setImportError] = useState<string | null>(null);

  const processContent = useCallback(
    (content: string, fileName: string): WorkflowParseResult | null => {
      setImportError(null);

      if (!content.trim()) {
        setImportError("No content to parse.");
        return null;
      }

      try {
        const result = parseWorkflowFile(content, fileName);

        setWorkflowImport({
          workflowJson: result.rawJson,
          parserResultJson: JSON.stringify(result.result),
          name: result.workflowName,
          platform: result.detection.platform,
        });

        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to parse workflow";
        setImportError(message);
        return null;
      }
    },
    [setWorkflowImport],
  );

  const processFile = useCallback(
    async (file: File): Promise<WorkflowParseResult | null> => {
      setImportError(null);

      if (!isSupportedFile(file.name)) {
        setImportError("Unsupported file type. Use .json or .yaml files.");
        return null;
      }

      if (file.size > MAX_FILE_SIZE) {
        setImportError(`File is too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Maximum is 5 MB.`);
        return null;
      }

      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => {
          const text = reader.result as string;
          const result = processContent(text, file.name);
          resolve(result);
        };
        reader.onerror = () => {
          setImportError("Failed to read the file.");
          resolve(null);
        };
        reader.readAsText(file);
      });
    },
    [processContent],
  );

  const clearImportError = useCallback(() => setImportError(null), []);

  return {
    processContent,
    processFile,
    importError,
    clearImportError,
  };
}
