import { useEffect, useState } from "react";
import { AbsoluteTime } from '@/features/shared/components/display/AbsoluteTime';
import { copyText } from '@/hooks/utility/interaction/useCopyToClipboard';
import {
  FileSignature,
  Download,
  Trash2,
  Clock,
  User,
  X,
  ShieldCheck,
  CheckCircle2,
  XCircle,
} from "lucide-react";

import { useTranslation } from "@/i18n/useTranslation";
import { toastCatch } from "@/lib/silentCatch";
import { useToastStore } from "@/stores/toastStore";
import { BaseModal } from "@/features/shared/components/modals";
import EmptyState from "@/features/shared/components/feedback/EmptyState";
import type { DocumentSignature, VerifyDocumentResult } from "@/api/signing";

import type { useSigning } from "./useSigning";

const TITLE_ID = "drive-signatures-panel-title";

// Width override — BaseModal's right-drawer default is 480px; this panel
// uses a tighter 420px footprint so it matches the original Phase-1 design.
const PANEL_CLASS =
  "relative h-full w-[420px] bg-background/95 border-l border-primary/25 shadow-elevation-4 overflow-hidden flex flex-col";

interface Props {
  signing: ReturnType<typeof useSigning>;
  onClose: () => void;
  onRevealInDrive?: (drivePath: string) => void;
}

export function DriveSignaturesPanel({
  signing,
  onClose,
  onRevealInDrive,
}: Props) {
  const { t } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);

  // Destructure the stable callback so the mount effect doesn't re-fire
  // every time `signing.signatures` changes (which it does inside
  // refreshSignatures → infinite loop).
  const { refreshSignatures } = signing;

  useEffect(() => {
    refreshSignatures().catch(() => {
      /* toasts handled in hook */
    });
  }, [refreshSignatures]);

  const handleExport = async (id: string) => {
    try {
      const json = await signing.exportSidecarJson(id);
      await copyText(json);
      addToast(t.plugins.doc_signing.export_sig, "success");
    } catch (e) {
      toastCatch("drive:signatures-export")(e);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await signing.removeSignature(id);
    } catch (e) {
      toastCatch("drive:signatures-delete")(e);
    }
  };

  return (
    <BaseModal
      isOpen
      onClose={onClose}
      titleId={TITLE_ID}
      placement="right-drawer"
      portal
      panelClassName={PANEL_CLASS}
    >
      <div className="contents">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-primary/15">
          <FileSignature className="w-4 h-4 text-rose-300" />
          <div id={TITLE_ID} className="typo-section-title flex-1">
            {t.plugins.doc_signing.history_heading}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-input text-foreground hover:text-foreground hover:bg-secondary/60 transition-colors focus-ring"
            aria-label={t.plugins.drive.cancel}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {signing.loadingSignatures && signing.signatures.length === 0 && (
            <div className="flex items-center justify-center py-10 typo-body text-foreground">
              {t.plugins.drive.loading}
            </div>
          )}

          {!signing.loadingSignatures && signing.signatures.length === 0 && (
            <EmptyState
              icon={FileSignature}
              iconColor="text-rose-300"
              iconContainerClassName="bg-rose-500/10 border-rose-500/25"
              title={t.plugins.doc_signing.no_signatures}
              subtitle={t.plugins.doc_signing.no_signatures_hint}
            />
          )}

          {signing.signatures.map((sig) => (
            <SignatureRow
              key={sig.id}
              sig={sig}
              signing={signing}
              onReveal={() => {
                if (sig.file_path && onRevealInDrive) {
                  onRevealInDrive(sig.file_path);
                  onClose();
                }
              }}
              onExport={() => handleExport(sig.id)}
              onDelete={() => handleDelete(sig.id)}
            />
          ))}
        </div>
      </div>
    </BaseModal>
  );
}

type RowVerifyState =
  | { status: "idle" }
  | { status: "verifying" }
  | { status: "done"; result: VerifyDocumentResult };

/**
 * One signature history row. Owns its own verify state so a "Verify now"
 * action can re-hash the live file against the record's sidecar and report
 * the outcome inline — without leaving the panel to hunt the file down and
 * right-click it. Verification uses the record's own exported sidecar
 * (`exportSidecarJson`), so it answers "does the file at this path still
 * match THIS signature?" — the question the history list implies.
 */
function SignatureRow({
  sig,
  signing,
  onReveal,
  onExport,
  onDelete,
}: {
  sig: DocumentSignature;
  signing: ReturnType<typeof useSigning>;
  onReveal: () => void;
  onExport: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const [verify, setVerify] = useState<RowVerifyState>({ status: "idle" });
  // No stored path → nothing to re-hash against; the verify affordance is
  // hidden rather than shown disabled (an un-actionable button reads as a bug).
  const canVerify = Boolean(sig.file_path);

  const handleVerify = async () => {
    // Capture into a local so the non-null narrowing survives the awaits
    // below (TS widens property accesses back to `string | null` across calls).
    const filePath = sig.file_path;
    if (!filePath) return;
    setVerify({ status: "verifying" });
    try {
      const sidecarJson = await signing.exportSidecarJson(sig.id);
      const result = await signing.verifyDriveFile(filePath, sidecarJson);
      setVerify({ status: "done", result });
    } catch (e) {
      // A throw here is almost always "file no longer at that path" — surface
      // it as a toast and reset, rather than faking a verify verdict.
      toastCatch("drive:signatures-verify")(e);
      setVerify({ status: "idle" });
    }
  };

  return (
    <div className="px-4 py-3 border-b border-primary/10 hover:bg-secondary/30 group transition-colors">
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <button
            type="button"
            onClick={onReveal}
            className="typo-body typo-card-label truncate hover:text-cyan-200 text-left transition-colors focus-ring"
          >
            {sig.file_name}
          </button>
          <div className="mt-1.5 flex items-center gap-3 typo-caption text-foreground">
            <span className="flex items-center gap-1">
              <User className="w-3 h-3" />
              <span className="text-foreground font-medium">{sig.signer_display_name}</span>
            </span>
            <span className="flex items-center gap-1 tabular-nums">
              <Clock className="w-3 h-3" />
              {<AbsoluteTime timestamp={sig.signed_at} />}
            </span>
          </div>
          <div className="mt-1 font-mono typo-caption text-foreground truncate">
            {sig.file_hash}
          </div>
          {verify.status === "verifying" && (
            <div className="mt-2 typo-caption text-foreground italic">
              {t.plugins.doc_signing.verifying}
            </div>
          )}
          {verify.status === "done" && <VerifyChip result={verify.result} />}
        </div>
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
          {canVerify && (
            <button
              type="button"
              onClick={handleVerify}
              disabled={verify.status === "verifying"}
              title={t.plugins.doc_signing.verify_signature}
              aria-label={t.plugins.doc_signing.verify_signature}
              className="p-1.5 rounded-input text-foreground hover:text-emerald-200 hover:bg-emerald-500/15 disabled:opacity-50 disabled:cursor-not-allowed transition-colors focus-ring"
            >
              <ShieldCheck className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            type="button"
            onClick={onExport}
            title={t.plugins.doc_signing.export_sig}
            className="p-1.5 rounded-input text-foreground hover:text-sky-200 hover:bg-sky-500/15 transition-colors focus-ring"
          >
            <Download className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={onDelete}
            title={t.plugins.doc_signing.delete_signature}
            className="p-1.5 rounded-input text-foreground hover:text-rose-200 hover:bg-rose-500/15 transition-colors focus-ring"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Compact inline verdict shown under a row after "Verify now". Green when the
 * file still matches the signature; rose when it doesn't, with the reason —
 * a changed file ("Modified") vs a file that matches but whose signature
 * doesn't validate ("Invalid").
 */
function VerifyChip({ result }: { result: VerifyDocumentResult }) {
  const { t } = useTranslation();
  const valid = result.valid;
  const Icon = valid ? CheckCircle2 : XCircle;
  const detail = valid
    ? t.plugins.doc_signing.unchanged
    : !result.file_hash_match
      ? t.plugins.doc_signing.modified
      : t.plugins.doc_signing.invalid;
  return (
    <div
      className={`mt-2 inline-flex items-center gap-1.5 px-2 py-1 rounded-full typo-caption font-medium border ${
        valid
          ? "border-emerald-500/35 bg-emerald-500/10 text-emerald-100"
          : "border-rose-500/35 bg-rose-500/10 text-rose-100"
      }`}
    >
      <Icon className="w-3 h-3 flex-shrink-0" />
      <span>
        {valid
          ? t.plugins.doc_signing.valid_signature
          : t.plugins.doc_signing.verification_failed}
      </span>
      <span aria-hidden className="opacity-50">·</span>
      <span>{detail}</span>
    </div>
  );
}
