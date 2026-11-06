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


import Button from '@/features/shared/components/buttons/Button';

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
    ensureIdentity().catch(silentCatch("DriveSignDialog:ensureIdentity"));
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
          <FileSignature className="w-4 h-4 text-status-error" />
          <div id={TITLE_ID} className="typo-section-title flex-1 truncate">
            {t.plugins.doc_signing.sign_heading}
          </div>
          <Button
            type="button"
            onClick={onClose}
            aria-label={t.plugins.drive.cancel}
            variant="ghost"
            size="icon-sm"
          >
            <X className="w-4 h-4" />
          </Button>
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
              <div className="typo-body text-foreground">
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
                className="w-full px-3 py-2 rounded-input bg-secondary/40 border border-primary/20 typo-body text-foreground placeholder:text-foreground focus:outline-none focus:border-status-info/40 focus:ring-2 focus:ring-status-info/20 resize-none transition-colors"
                placeholder={debtText("auto_optional_context_stored_alongside_the_sign_ab2cb9d2")}
              />
            </div>
          )}

          {/* Result preview */}
          {phase === "done" && sidecarJson && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <CheckCircle2 className="w-4 h-4 text-status-success" />
                <span className="typo-body text-status-success">
                  {t.plugins.doc_signing.signed_success}
                </span>
              </div>
              <pre className="max-h-64 overflow-auto rounded-input border border-primary/15 bg-background/70 p-3 typo-body font-mono text-foreground whitespace-pre-wrap break-words">
                {sidecarJson}
              </pre>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-primary/15">
          {phase === "done" ? (
            <>
              <Button
                type="button"
                onClick={handleCopy}
                variant="ghost"
                size="sm"
              >
                <Copy className="w-3.5 h-3.5" />
                {t.plugins.doc_signing.copy}
              </Button>
              <Button
                type="button"
                onClick={handleSaveToDrive}
                variant="secondary"
                size="sm"
              >
                <Download className="w-3.5 h-3.5" />
                {t.plugins.doc_signing.save_sig_json}
              </Button>
              <Button
                type="button"
                onClick={onClose}
                variant="ghost"
                size="sm"
              >
                {t.plugins.drive.confirm}
              </Button>
            </>
          ) : (
            <>
              <Button
                type="button"
                onClick={onClose}
                disabled={phase === "signing"}
                variant="ghost"
                size="sm"
              >
                {t.plugins.drive.cancel}
              </Button>
              <Button
                type="button"
                onClick={handleSign}
                disabled={phase === "signing"}
                variant="danger"
                size="sm"
              >
                {phase === "signing"
                  ? t.plugins.doc_signing.signing
                  : t.plugins.doc_signing.sign_document}
              </Button>
            </>
          )}
        </div>
      </div>
    </BaseModal>
  );
}
