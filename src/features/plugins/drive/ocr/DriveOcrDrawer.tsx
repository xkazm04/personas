import { useEffect, useRef, useState } from "react";
import {
  ScanLine,
  X,
  Sparkles,
  Save,
  Copy,
  CheckCircle2,
  FileText,
} from "lucide-react";

import { cancelOcrOperation } from "@/api/ocr";
import {
  driveWriteText,
  ocrDriveFileClaude,
  ocrDriveFileGemini,
  type DriveEntry,
  type OcrDriveResult,
} from "@/api/drive";
import { useTranslation } from "@/i18n/useTranslation";
import { silentCatch, toastCatch } from "@/lib/silentCatch";
import { useToastStore } from "@/stores/toastStore";

import type { useOcr } from "./useOcr";

interface Props {
  entry: DriveEntry;
  ocr: ReturnType<typeof useOcr>;
  onClose: () => void;
  onFileWritten?: (relPath: string) => void;
}

type Phase = "input" | "running" | "done";
type Backend = "gemini" | "claude";

const DEFAULT_OUTPUT_SUFFIX = ".ocr.txt";

export function DriveOcrDrawer({ entry, ocr, onClose, onFileWritten }: Props) {
  const { t } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const [phase, setPhase] = useState<Phase>("input");
  const [prompt, setPrompt] = useState("");
  const [result, setResult] = useState<OcrDriveResult | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  // Default to Gemini when a credential is connected, otherwise Claude
  // (which only needs the local CLI). Users can flip either way.
  const [backend, setBackend] = useState<Backend>(
    ocr.hasGemini ? "gemini" : "claude",
  );
  // Tracks the in-flight OCR call so a drawer close mid-run can signal
  // the backend to abort the reqwest future instead of silently paying
  // for a Gemini call whose result we'll throw away.
  const operationIdRef = useRef<string | null>(null);

  const cancelInFlight = () => {
    const id = operationIdRef.current;
    if (id) {
      cancelOcrOperation(id).catch(silentCatch("drive:ocr:cancel"));
      operationIdRef.current = null;
    }
  };

  const handleClose = () => {
    cancelInFlight();
    onClose();
  };

  useEffect(() => {
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
    // handleClose is stable for this component's lifetime; refs don't
    // need a dep entry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose]);

  // Best-effort cleanup if the drawer unmounts for any other reason
  // (parent re-render, route change). Mirrors the manual close path.
  useEffect(() => () => cancelInFlight(), []);

  const canExtract =
    backend === "gemini" ? Boolean(ocr.geminiCredentialId) : true;

  const handleExtract = async () => {
    if (!canExtract) return;
    setPhase("running");
    setResult(null);
    setSaved(null);
    const trimmedPrompt = prompt.trim() || undefined;
    try {
      let res: OcrDriveResult;
      if (backend === "gemini") {
        const operationId = crypto.randomUUID();
        operationIdRef.current = operationId;
        res = await ocrDriveFileGemini(
          entry.path,
          ocr.geminiCredentialId!,
          trimmedPrompt,
          operationId,
        );
      } else {
        // Claude CLI path: no operation_id wired (cancel would need to
        // kill the spawned child; deferred to a follow-up if it bites).
        res = await ocrDriveFileClaude(entry.path, trimmedPrompt);
      }
      setResult(res);
      setPhase("done");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // Cancellation is a user-initiated outcome, not an error to surface.
      if (!msg.includes("OCR cancelled")) {
        toastCatch("drive:ocr")(e);
      }
      setPhase("input");
    } finally {
      operationIdRef.current = null;
    }
  };

  const handleSave = async () => {
    if (!result) return;
    const defaultName = `${entry.name}${DEFAULT_OUTPUT_SUFFIX}`;
    const parentSegments = entry.path.split("/").slice(0, -1);
    const targetRel = [...parentSegments, defaultName].filter(Boolean).join("/");
    try {
      const written = await driveWriteText(targetRel, result.document.extracted_text);
      setSaved(written.path);
      addToast(`\u2713 ${written.path}`, "success");
      onFileWritten?.(written.path);
    } catch (e) {
      toastCatch("drive:ocr:save")(e);
    }
  };

  const handleCopy = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.document.extracted_text);
      addToast(t.plugins.drive.ocr_copied, "success");
    } catch {
      /* clipboard blocked */
    }
  };

  return (
    <div
      className="fixed inset-0 z-[9998] flex items-start justify-end bg-background/50 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      <aside className="w-[480px] h-full flex flex-col bg-background/95 border-l border-primary/20 shadow-elevation-4">
        {/* Header */}
        <div className="relative px-5 py-4 border-b border-primary/10 overflow-hidden">
          <div
            aria-hidden
            className="absolute inset-0 bg-gradient-to-br from-violet-500/15 via-fuchsia-500/5 to-transparent pointer-events-none"
          />
          <div className="relative flex items-center gap-3">
            <div className="w-10 h-10 rounded-modal bg-gradient-to-br from-violet-500/35 to-fuchsia-500/10 border border-violet-500/50 flex items-center justify-center shadow-[0_0_18px_-4px_rgba(167,139,250,0.6)]">
              <ScanLine className="w-5 h-5 text-violet-100" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="typo-section-title">
                {backend === "claude"
                  ? t.plugins.drive.ocr_title_claude
                  : t.plugins.drive.ocr_title}
              </div>
              <div className="typo-caption text-foreground truncate">
                {backend === "claude"
                  ? t.plugins.drive.ocr_subtitle_claude
                  : t.plugins.drive.ocr_subtitle}
              </div>
            </div>
            <button
              type="button"
              onClick={handleClose}
              className="p-1.5 rounded-input text-foreground hover:text-foreground hover:bg-secondary/60 transition-colors"
              aria-label={t.plugins.drive.cancel}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* File card */}
          <div className="rounded-card border border-primary/15 bg-secondary/30 px-3 py-2.5">
            <div className="typo-label text-foreground mb-1">
              {t.plugins.drive.details_path}
            </div>
            <div className="typo-body font-mono text-foreground break-all">
              {entry.path}
            </div>
            {entry.mime && (
              <div className="mt-1.5 typo-caption text-foreground font-mono">
                {entry.mime}
              </div>
            )}
          </div>

          {/* Backend selector — only adjustable before extraction starts */}
          {phase !== "done" && (
            <div>
              <label className="typo-label text-foreground block mb-2">
                {t.plugins.drive.ocr_backend_label}
              </label>
              <div className="grid grid-cols-2 gap-2">
                {(["gemini", "claude"] as const).map((b) => (
                  <button
                    key={b}
                    type="button"
                    onClick={() => setBackend(b)}
                    disabled={phase === "running"}
                    className={`rounded-input border px-3 py-2 typo-body font-semibold text-left transition-colors ${
                      backend === b
                        ? "border-violet-500/55 bg-violet-500/20 text-violet-50 shadow-[0_0_14px_-6px_rgba(167,139,250,0.6)]"
                        : "border-primary/20 bg-secondary/30 text-foreground hover:bg-secondary/50 hover:border-primary/30"
                    } disabled:opacity-50 disabled:cursor-not-allowed`}
                  >
                    {b === "gemini"
                      ? t.plugins.drive.ocr_backend_gemini
                      : t.plugins.drive.ocr_backend_claude}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Model info */}
          <div className="rounded-card border border-violet-500/35 bg-violet-500/10 px-3 py-2 flex items-center gap-2">
            <Sparkles className="w-3.5 h-3.5 text-violet-200 flex-shrink-0" />
            <div className="typo-body text-foreground">
              <span className="font-semibold text-violet-100">
                {t.plugins.drive.ocr_model_label}
              </span>{" "}
              <span className="font-mono">
                {backend === "claude" ? "claude-code-cli" : "gemini-3-flash-preview"}
              </span>
            </div>
          </div>

          {/* Backend status: Gemini → credential card; Claude → CLI info */}
          {backend === "gemini" ? (
            ocr.hasGemini ? (
              <div className="rounded-card border border-emerald-500/35 bg-emerald-500/10 px-3 py-2 flex items-center gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-200 flex-shrink-0" />
                <div className="typo-body text-foreground">
                  {t.plugins.drive.ocr_connector_ready}:{" "}
                  <span className="font-semibold text-emerald-100">
                    {ocr.geminiCredentialName}
                  </span>
                </div>
              </div>
            ) : (
              <div className="rounded-card border border-amber-500/40 bg-amber-500/10 px-3 py-2 typo-body text-amber-100">
                {t.plugins.drive.ocr_connector_missing}
              </div>
            )
          ) : (
            <div className="rounded-card border border-sky-500/40 bg-sky-500/10 px-3 py-2 typo-body text-foreground">
              {t.plugins.drive.ocr_claude_info}
            </div>
          )}

          {/* Optional prompt */}
          {phase !== "done" && (
            <div>
              <label className="typo-label text-foreground block mb-2">
                {t.plugins.drive.ocr_prompt_label}
              </label>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={3}
                placeholder={t.plugins.drive.ocr_prompt_placeholder}
                className="w-full px-3 py-2 rounded-input bg-secondary/40 border border-primary/20 typo-body text-foreground placeholder:text-foreground focus:outline-none focus:border-violet-500/50 focus:ring-2 focus:ring-violet-500/20 resize-none transition-colors"
              />
            </div>
          )}

          {/* Result */}
          {phase === "done" && result && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-200" />
                <span className="typo-body font-semibold text-emerald-100">
                  {t.plugins.drive.ocr_done}
                </span>
                <span className="typo-caption text-foreground tabular-nums ml-auto">
                  {result.document.duration_ms}ms
                  {result.document.token_count !== null &&
                    ` \u2022 ${result.document.token_count} tokens`}
                </span>
              </div>
              <pre className="max-h-96 overflow-auto rounded-card border border-primary/15 bg-background/70 p-3 typo-body font-mono text-foreground whitespace-pre-wrap break-words leading-relaxed">
                {result.document.extracted_text || "(empty)"}
              </pre>
              {saved && (
                <div className="flex items-center gap-2 rounded-input bg-emerald-500/15 border border-emerald-500/35 px-3 py-1.5 typo-body text-emerald-100">
                  <FileText className="w-3.5 h-3.5" />
                  {t.plugins.drive.ocr_saved_to}:{" "}
                  <span className="font-mono text-emerald-50">{saved}</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-primary/15">
          {phase === "done" ? (
            <>
              <button
                type="button"
                onClick={handleCopy}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-input typo-body font-medium text-foreground hover:bg-secondary/60 transition-colors"
              >
                <Copy className="w-3.5 h-3.5" />
                {t.plugins.doc_signing.copy}
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={!!saved}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-input bg-gradient-to-b from-violet-500/30 to-fuchsia-500/10 text-violet-50 border border-violet-500/50 typo-body font-semibold hover:from-violet-500/40 hover:to-fuchsia-500/15 disabled:opacity-50 transition-all"
              >
                <Save className="w-3.5 h-3.5" />
                {saved ? t.plugins.drive.ocr_saved : t.plugins.drive.ocr_save}
              </button>
              <button
                type="button"
                onClick={handleClose}
                className="px-3 py-1.5 rounded-input typo-body font-medium text-foreground hover:bg-secondary/60 transition-colors"
              >
                {t.plugins.drive.confirm}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={handleClose}
                className="px-3 py-1.5 rounded-input typo-body font-medium text-foreground hover:bg-secondary/60 transition-colors"
              >
                {t.plugins.drive.cancel}
              </button>
              <button
                type="button"
                onClick={handleExtract}
                disabled={!canExtract || phase === "running"}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-input bg-gradient-to-b from-violet-500/30 to-fuchsia-500/10 text-violet-50 border border-violet-500/50 typo-body font-semibold hover:from-violet-500/40 hover:to-fuchsia-500/15 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-[0_0_14px_-4px_rgba(167,139,250,0.5)]"
              >
                <ScanLine className="w-3.5 h-3.5" />
                {phase === "running"
                  ? t.plugins.drive.ocr_running
                  : t.plugins.drive.ocr_extract}
              </button>
            </>
          )}
        </div>
      </aside>
    </div>
  );
}
