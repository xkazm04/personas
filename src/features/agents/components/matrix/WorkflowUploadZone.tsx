/**
 * Compact workflow upload zone for the MatrixCommandCenter.
 *
 * Provides drag-and-drop file upload with a paste fallback.
 * After a workflow is parsed, shows a summary with platform badge,
 * workflow name, and entity counts.
 */
import { useRef, useState, useCallback, type DragEvent } from "react";
import { Upload, FileJson, X, Workflow } from "lucide-react";
import { useAgentStore } from "@/stores/agentStore";
import { useMatrixWorkflowImport } from "./useMatrixWorkflowImport";
import { useTranslation } from '@/i18n/useTranslation';

interface WorkflowUploadZoneProps {
  onWorkflowReady?: () => void;
}

const PLATFORM_LABELS: Record<string, string> = {
  n8n: "n8n",
  zapier: "Zapier",
  make: "Make",
  "github-actions": "GitHub Actions",
  unknown: "Workflow",
};

const PLATFORM_COLORS: Record<string, string> = {
  n8n: "bg-orange-500/15 text-orange-400 border-orange-500/25",
  zapier: "bg-amber-500/15 text-amber-400 border-amber-500/25",
  make: "bg-purple-500/15 text-purple-400 border-purple-500/25",
  "github-actions": "bg-blue-500/15 text-blue-400 border-blue-500/25",
  unknown: "bg-zinc-500/15 text-zinc-400 border-zinc-500/25",
};

export function WorkflowUploadZone({ onWorkflowReady }: WorkflowUploadZoneProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [pasteMode, setPasteMode] = useState(false);
  const [pasteValue, setPasteValue] = useState("");

  const { t } = useTranslation();
  const { processFile, processContent, importError, clearImportError } = useMatrixWorkflowImport();

  const workflowName = useAgentStore((s) => s.buildWorkflowName);
  const workflowPlatform = useAgentStore((s) => s.buildWorkflowPlatform);
  const clearWorkflowImport = useAgentStore((s) => s.clearWorkflowImport);

  const hasWorkflow = !!workflowName;

  // -- Handlers --

  const handleFileSelect = useCallback(
    async (file: File) => {
      const result = await processFile(file);
      if (result) onWorkflowReady?.();
    },
    [processFile, onWorkflowReady],
  );

  const handleDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFileSelect(file);
    },
    [handleFileSelect],
  );

  const handlePasteSubmit = useCallback(() => {
    if (!pasteValue.trim()) return;
    const result = processContent(pasteValue, "pasted-workflow.json");
    if (result) {
      setPasteMode(false);
      setPasteValue("");
      onWorkflowReady?.();
    }
  }, [pasteValue, processContent, onWorkflowReady]);

  const handleClear = useCallback(() => {
    clearWorkflowImport();
    clearImportError();
    setPasteMode(false);
    setPasteValue("");
  }, [clearWorkflowImport, clearImportError]);

  // -- Loaded state --
  if (hasWorkflow) {
    const platform = workflowPlatform ?? "unknown";
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2 p-2.5 rounded-card border border-primary/15 bg-primary/5">
          <Workflow className="w-4 h-4 text-primary/60 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border ${PLATFORM_COLORS[platform] ?? PLATFORM_COLORS.unknown}`}>
                {PLATFORM_LABELS[platform] ?? "Workflow"}
              </span>
              <span className="text-[12px] font-medium text-foreground truncate">
                {workflowName}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={handleClear}
            className="p-1 rounded hover:bg-secondary/40 text-foreground hover:text-muted-foreground/80 transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
        <p className="text-[11px] text-foreground px-1">
          {t.agents.workflow_upload.build_hint}
        </p>
      </div>
    );
  }

  // -- Paste mode --
  if (pasteMode) {
    return (
      <div className="space-y-2">
        <textarea
          className="w-full min-h-[80px] max-h-[120px] rounded-card border border-primary/15 bg-background/40 px-3 py-2 text-[12px] text-foreground placeholder-muted-foreground/40 resize-none focus:outline-none focus:ring-1 focus:ring-primary/30"
          placeholder={t.agents.workflow_upload.paste_placeholder}
          value={pasteValue}
          onChange={(e) => setPasteValue(e.target.value)}
          autoFocus
        />
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handlePasteSubmit}
            disabled={!pasteValue.trim()}
            className="px-3 py-1 rounded text-[11px] font-medium bg-primary/15 text-primary hover:bg-primary/25 disabled:opacity-40 transition-colors"
          >
            {t.agents.workflow_upload.parse}
          </button>
          <button
            type="button"
            onClick={() => { setPasteMode(false); setPasteValue(""); clearImportError(); }}
            className="px-3 py-1 rounded text-[11px] text-foreground hover:text-muted-foreground/80 transition-colors"
          >
            {t.common.cancel}
          </button>
        </div>
        {importError && (
          <p className="text-[11px] text-red-400/80 px-1">{importError}</p>
        )}
      </div>
    );
  }

  // -- Upload zone --
  return (
    <div className="space-y-2">
      <div
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`flex flex-col items-center justify-center gap-2 px-4 py-5 rounded-card border border-dashed cursor-pointer transition-colors ${
          isDragging
            ? "border-primary/40 bg-primary/5"
            : "border-primary/15 bg-background/20 hover:border-primary/25 hover:bg-background/30"
        }`}
      >
        <Upload className="w-5 h-5 text-foreground" />
        <div className="text-center">
          <p className="text-[12px] text-foreground">
            {t.agents.workflow_upload.drop_file}
          </p>
          <p className="text-[10px] text-foreground mt-0.5">
            {t.agents.workflow_upload.file_types}
          </p>
        </div>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,.yaml,.yml"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFileSelect(file);
          e.target.value = "";
        }}
      />
      <button
        type="button"
        onClick={() => setPasteMode(true)}
        className="flex items-center gap-1.5 text-[11px] text-foreground hover:text-muted-foreground/70 transition-colors"
      >
        <FileJson className="w-3.5 h-3.5" />
        {t.agents.workflow_upload.paste_json}
      </button>
      {importError && (
        <p className="text-[11px] text-red-400/80 px-1">{importError}</p>
      )}
    </div>
  );
}
