import { useEffect } from "react";
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

import type { useSigning } from "./useSigning";

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
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [refreshSignatures, onClose]);

  const handleExport = async (id: string) => {
    try {
      const json = await signing.exportSidecarJson(id);
      await navigator.clipboard.writeText(json);
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
    <div
      className="fixed inset-0 z-[9998] flex items-start justify-end bg-background/50 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <aside className="w-[420px] h-full flex flex-col bg-background/95 border-l border-primary/20 shadow-elevation-4">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-primary/10">
          <FileSignature className="w-4 h-4 text-rose-400" />
          <div className="typo-heading-sm typo-section-title flex-1">
            {t.plugins.doc_signing.history_heading}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-md text-foreground/90 hover:text-foreground hover:bg-secondary/50"
            aria-label={t.plugins.drive.cancel}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {signing.loadingSignatures && signing.signatures.length === 0 && (
            <div className="flex items-center justify-center py-10 typo-body text-foreground/90">
              {t.plugins.drive.loading}
            </div>
          )}

          {!signing.loadingSignatures && signing.signatures.length === 0 && (
            <div className="flex flex-col items-center justify-center gap-2 py-10 px-6 text-center">
              <FileSignature className="w-10 h-10 text-foreground/90" />
              <div className="typo-body text-foreground/90">
                {t.plugins.doc_signing.no_signatures}
              </div>
              <div className="typo-body text-foreground/90">
                {t.plugins.doc_signing.no_signatures_hint}
              </div>
            </div>
          )}

          {signing.signatures.map((sig) => (
            <div
              key={sig.id}
              className="px-4 py-3 border-b border-primary/10 hover:bg-secondary/20 group"
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
                    className="typo-body typo-card-label truncate hover:text-sky-300 text-left"
                  >
                    {sig.file_name}
                  </button>
                  <div className="mt-1 flex items-center gap-3 typo-body text-foreground/90">
                    <span className="flex items-center gap-1">
                      <User className="w-3 h-3" />
                      {sig.signer_display_name}
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {new Date(sig.signed_at).toLocaleString()}
                    </span>
                  </div>
                  <div className="mt-1 font-mono typo-body text-foreground/90 truncate">
                    {sig.file_hash}
                  </div>
                </div>
                <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    type="button"
                    onClick={() => handleExport(sig.id)}
                    title={t.plugins.doc_signing.export_sig}
                    className="p-1.5 rounded-md text-foreground/90 hover:text-sky-300 hover:bg-sky-500/10"
                  >
                    <Download className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(sig.id)}
                    title={t.plugins.doc_signing.delete_signature}
                    className="p-1.5 rounded-md text-foreground/90 hover:text-rose-300 hover:bg-rose-500/10"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}
