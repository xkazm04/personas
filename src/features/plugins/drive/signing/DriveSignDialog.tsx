import { useEffect, useState } from "react";
import { copyText } from '@/hooks/utility/interaction/useCopyToClipboard';
import { FileSignature, CheckCircle2, Copy, Download, X } from "lucide-react";

import type { DriveEntry } from "@/api/drive";
import { useTranslation } from "@/i18n/useTranslation";
import { silentCatch, toastCatch } from "@/lib/silentCatch";
import { useToastStore } from "@/stores/toastStore";
import { BaseModal } from "@/features/shared/components/modals";

import type { useSigning } from "./useSigning";
import { debtText } from '@/i18n/DebtText';


const TITLE_ID = "drive-sign-dialog-title";

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
  }, [ensureIdentity]);

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
      await copyText(sidecarJson);
      addToast(t.plugins.doc_signing.copy, "success");
    } catch (err) { silentCatch("features/plugins/drive/signing/DriveSignDialog:catch1")(err); }
  };

  return (
    <BaseModal
      isOpen
      onClose={onClose}
      titleId={TITLE_ID}
      portal
      maxWidthClass="max-w-none"
      panelClassName="w-[520px] max-h-[80vh] flex flex-col rounded-modal border border-primary/25 bg-background/95 shadow-elevation-3"
    >
      <div className="contents">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-primary/15">
          <FileSignature className="w-4 h-4 text-rose-300" />
          <div id={TITLE_ID} className="typo-section-title flex-1 truncate">
            {t.plugins.doc_signing.sign_heading}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-input text-foreground hover:text-foreground hover:bg-secondary/60 transition-colors"
            aria-label={t.plugins.drive.cancel}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3">
          {/* File info */}
          <div className="mb-3 rounded-card border border-primary/15 bg-secondary/30 px-3 py-2">
            <div className="typo-label text-foreground mb-1">
              {t.plugins.drive.details_path}
            </div>
            <div className="typo-body font-mono text-foreground break-all">
              {entry.path}
            </div>
          </div>

          {/* Signer identity */}
          {signing.identity && (
            <div className="mb-3 rounded-card border border-primary/15 bg-secondary/25 px-3 py-2">
              <div className="typo-label text-foreground mb-1">
                {t.plugins.doc_signing.signing_as}
              </div>
              <div className="typo-body text-foreground font-semibold">
                {signing.identity.displayName}
              </div>
              <div className="typo-caption text-foreground font-mono mt-0.5 truncate">
                {signing.identity.peerId}
              </div>
            </div>
          )}

          {/* Metadata */}
          {phase !== "done" && (
            <div>
              <label className="typo-label text-foreground block mb-1.5">
                {t.plugins.doc_signing.notes_label}
              </label>
              <textarea
                value={metadata}
                onChange={(e) => setMetadata(e.target.value)}
                rows={3}
                className="w-full px-3 py-2 rounded-input bg-secondary/40 border border-primary/20 typo-body text-foreground placeholder:text-foreground focus:outline-none focus:border-sky-500/50 focus:ring-2 focus:ring-sky-500/20 resize-none transition-colors"
                placeholder={debtText("auto_optional_context_stored_alongside_the_sign_ab2cb9d2")}
              />
            </div>
          )}

          {/* Result preview */}
          {phase === "done" && sidecarJson && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-300" />
                <span className="typo-body font-semibold text-emerald-100">
                  {t.plugins.doc_signing.signed_success}
                </span>
              </div>
              <pre className="max-h-64 overflow-auto rounded-input border border-primary/15 bg-background/70 p-3 typo-body font-mono text-foreground whitespace-pre-wrap break-words leading-relaxed">
                {sidecarJson}
              </pre>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-primary/15">
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
                onClick={handleSaveToDrive}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-input bg-sky-500/25 text-sky-100 border border-sky-500/40 typo-body font-semibold hover:bg-sky-500/35 transition-colors"
              >
                <Download className="w-3.5 h-3.5" />
                {t.plugins.doc_signing.save_sig_json}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="px-3 py-1.5 rounded-input typo-body font-medium text-foreground hover:bg-secondary/60 transition-colors"
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
                className="px-3 py-1.5 rounded-input typo-body font-medium text-foreground hover:bg-secondary/60 disabled:opacity-50 transition-colors"
              >
                {t.plugins.drive.cancel}
              </button>
              <button
                type="button"
                onClick={handleSign}
                disabled={phase === "signing"}
                className="px-3 py-1.5 rounded-input bg-rose-500/25 text-rose-100 border border-rose-500/45 typo-body font-semibold hover:bg-rose-500/35 disabled:opacity-50 transition-colors"
              >
                {phase === "signing"
                  ? t.plugins.doc_signing.signing
                  : t.plugins.doc_signing.sign_document}
              </button>
            </>
          )}
        </div>
      </div>
    </BaseModal>
  );
}
