import { useEffect, useState } from "react";
import { FileSignature, CheckCircle2, Copy, Download, X } from "lucide-react";

import type { DriveEntry } from "@/api/drive";
import { useTranslation } from "@/i18n/useTranslation";
import { toastCatch } from "@/lib/silentCatch";
import { useToastStore } from "@/stores/toastStore";

import type { useSigning } from "./useSigning";

interface Props {
  entry: DriveEntry;
  signing: ReturnType<typeof useSigning>;
  onClose: () => void;
  onSidecarWritten?: (relPath: string) => void;
}

type Phase = "input" | "signing" | "done";

export function DriveSignDialog({
  entry,
  signing,
  onClose,
  onSidecarWritten,
}: Props) {
  const { t } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const [phase, setPhase] = useState<Phase>("input");
  const [metadata, setMetadata] = useState("");
  const [sidecarJson, setSidecarJson] = useState<string | null>(null);

  const { ensureIdentity } = signing;

  useEffect(() => {
    ensureIdentity().catch(() => {
      /* surfaced inline below */
    });
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [ensureIdentity, onClose]);

  const handleSign = async () => {
    setPhase("signing");
    try {
      const result = await signing.signDriveFile(
        entry.path,
        metadata.trim() || undefined,
      );
      setSidecarJson(result.sidecar_json);
      setPhase("done");
      addToast(t.plugins.doc_signing.signed_success, "success");
    } catch (e) {
      toastCatch("drive:sign")(e);
      setPhase("input");
    }
  };

  const handleSaveToDrive = async () => {
    if (!sidecarJson) return;
    try {
      const rel = await signing.writeSidecarToDrive(entry.path, sidecarJson);
      addToast(`\u2713 ${rel}`, "success");
      onSidecarWritten?.(rel);
    } catch (e) {
      toastCatch("drive:sidecar-write")(e);
    }
  };

  const handleCopy = async () => {
    if (!sidecarJson) return;
    try {
      await navigator.clipboard.writeText(sidecarJson);
      addToast(t.plugins.doc_signing.copy, "success");
    } catch {
      /* clipboard blocked */
    }
  };

  return (
    <div
      className="fixed inset-0 z-[9998] flex items-center justify-center bg-background/60 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-[520px] max-h-[80vh] flex flex-col rounded-xl border border-primary/20 bg-background/95 shadow-xl">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-primary/10">
          <FileSignature className="w-4 h-4 text-rose-400" />
          <div className="typo-heading-sm text-foreground flex-1 truncate">
            {t.plugins.doc_signing.sign_heading}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-md text-foreground/50 hover:text-foreground hover:bg-secondary/50"
            aria-label={t.plugins.drive.cancel}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3">
          {/* File info */}
          <div className="mb-3 rounded-lg border border-primary/10 bg-secondary/30 px-3 py-2">
            <div className="typo-caption-sm text-foreground/50 uppercase tracking-wide">
              {t.plugins.drive.details_path}
            </div>
            <div className="typo-caption font-mono text-foreground/90 break-all">
              {entry.path}
            </div>
          </div>

          {/* Signer identity */}
          {signing.identity && (
            <div className="mb-3 typo-caption text-foreground/60">
              {t.plugins.doc_signing.signing_as}:{" "}
              <span className="text-foreground/90 font-medium">
                {signing.identity.displayName}
              </span>
              <div className="typo-caption-sm text-foreground/40 font-mono mt-0.5 truncate">
                {signing.identity.peerId}
              </div>
            </div>
          )}

          {/* Metadata */}
          {phase !== "done" && (
            <div>
              <label className="typo-caption-sm text-foreground/50 uppercase tracking-wide block mb-1">
                {t.plugins.doc_signing.notes_label}
              </label>
              <textarea
                value={metadata}
                onChange={(e) => setMetadata(e.target.value)}
                rows={3}
                className="w-full px-3 py-2 rounded-md bg-secondary/40 border border-primary/15 typo-body text-foreground placeholder:text-foreground/40 focus:outline-none focus:ring-1 focus:ring-sky-500/50 resize-none"
                placeholder="Optional context stored alongside the signature..."
              />
            </div>
          )}

          {/* Result preview */}
          {phase === "done" && sidecarJson && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                <span className="typo-caption font-medium text-emerald-300">
                  {t.plugins.doc_signing.signed_success}
                </span>
              </div>
              <pre className="max-h-64 overflow-auto rounded-md border border-primary/10 bg-secondary/20 p-2 typo-caption-sm font-mono text-foreground/80 whitespace-pre-wrap break-words">
                {sidecarJson}
              </pre>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-primary/10">
          {phase === "done" ? (
            <>
              <button
                type="button"
                onClick={handleCopy}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md typo-caption font-medium text-foreground/80 hover:bg-secondary/50 transition-colors"
              >
                <Copy className="w-3.5 h-3.5" />
                {t.plugins.doc_signing.copy}
              </button>
              <button
                type="button"
                onClick={handleSaveToDrive}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-sky-500/20 text-sky-300 border border-sky-500/30 typo-caption font-medium hover:bg-sky-500/30 transition-colors"
              >
                <Download className="w-3.5 h-3.5" />
                {t.plugins.doc_signing.save_sig_json}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="px-3 py-1.5 rounded-md typo-caption font-medium text-foreground/70 hover:bg-secondary/50 transition-colors"
              >
                {t.plugins.drive.confirm}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={onClose}
                disabled={phase === "signing"}
                className="px-3 py-1.5 rounded-md typo-caption font-medium text-foreground/70 hover:bg-secondary/50 disabled:opacity-50 transition-colors"
              >
                {t.plugins.drive.cancel}
              </button>
              <button
                type="button"
                onClick={handleSign}
                disabled={phase === "signing"}
                className="px-3 py-1.5 rounded-md bg-rose-500/20 text-rose-300 border border-rose-500/30 typo-caption font-medium hover:bg-rose-500/30 disabled:opacity-50 transition-colors"
              >
                {phase === "signing"
                  ? t.plugins.doc_signing.signing
                  : t.plugins.doc_signing.sign_document}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
