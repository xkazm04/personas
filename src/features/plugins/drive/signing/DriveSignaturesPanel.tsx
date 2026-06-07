import { useEffect } from "react";
import { AbsoluteTime } from '@/features/shared/components/display/AbsoluteTime';
import { copyText } from '@/hooks/utility/interaction/useCopyToClipboard';
import {
  FileSignature,
  Download,
  Trash2,
  Clock,
  User,
  X,
} from "lucide-react";

import { useTranslation } from "@/i18n/useTranslation";
import { toastCatch } from "@/lib/silentCatch";
import { useToastStore } from "@/stores/toastStore";
import { BaseModal } from "@/features/shared/components/modals";
import EmptyState from "@/features/shared/components/feedback/EmptyState";

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
            <div
              key={sig.id}
              className="px-4 py-3 border-b border-primary/10 hover:bg-secondary/30 group transition-colors"
            >
              <div className="flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  <button
                    type="button"
                    onClick={() => {
                      if (sig.file_path && onRevealInDrive) {
                        onRevealInDrive(sig.file_path);
                        onClose();
                      }
                    }}
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
                </div>
                <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    type="button"
                    onClick={() => handleExport(sig.id)}
                    title={t.plugins.doc_signing.export_sig}
                    className="p-1.5 rounded-input text-foreground hover:text-sky-200 hover:bg-sky-500/15 transition-colors focus-ring"
                  >
                    <Download className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(sig.id)}
                    title={t.plugins.doc_signing.delete_signature}
                    className="p-1.5 rounded-input text-foreground hover:text-rose-200 hover:bg-rose-500/15 transition-colors focus-ring"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </BaseModal>
  );
}
