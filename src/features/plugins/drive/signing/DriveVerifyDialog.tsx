import { useEffect, useState } from "react";
import {
  ShieldCheck,
  CheckCircle2,
  XCircle,
  Search,
  X,
} from "lucide-react";

import type { DriveEntry } from "@/api/drive";
import { useTranslation } from "@/i18n/useTranslation";
import { toastCatch } from "@/lib/silentCatch";
import type { VerifyDocumentResult } from "@/api/signing";

import type { useSigning } from "./useSigning";

interface Props {
  entry: DriveEntry;
  signing: ReturnType<typeof useSigning>;
  onClose: () => void;
}

type Phase = "input" | "verifying" | "done";

export function DriveVerifyDialog({ entry, signing, onClose }: Props) {
  const { t } = useTranslation();
  const [sidecarJson, setSidecarJson] = useState<string>("");
  const [phase, setPhase] = useState<Phase>("input");
  const [result, setResult] = useState<VerifyDocumentResult | null>(null);
  const [sidecarFound, setSidecarFound] = useState<boolean | null>(null);

  const { findSidecarInDrive } = signing;

  // Auto-look up a sidecar sibling in the drive on mount.
  useEffect(() => {
    let cancelled = false;
    findSidecarInDrive(entry.path)
      .then((json) => {
        if (cancelled) return;
        if (json) {
          setSidecarJson(json);
          setSidecarFound(true);
        } else {
          setSidecarFound(false);
        }
      })
      .catch(() => setSidecarFound(false));

    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", esc);
    return () => {
      cancelled = true;
      document.removeEventListener("keydown", esc);
    };
  }, [entry.path, findSidecarInDrive, onClose]);

  const handleVerify = async () => {
    if (!sidecarJson.trim()) return;
    setPhase("verifying");
    try {
      const res = await signing.verifyDriveFile(entry.path, sidecarJson);
      setResult(res);
      setPhase("done");
    } catch (e) {
      toastCatch("drive:verify")(e);
      setPhase("input");
    }
  };

  return (
    <div
      className="fixed inset-0 z-[9998] flex items-center justify-center bg-background/60 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-[560px] max-h-[85vh] flex flex-col rounded-xl border border-primary/20 bg-background/95 shadow-xl">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-primary/10">
          <ShieldCheck className="w-4 h-4 text-sky-400" />
          <div className="typo-heading-sm text-foreground flex-1 truncate">
            {t.plugins.doc_signing.verify_heading}
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

          {/* Sidecar lookup status */}
          {sidecarFound !== null && phase === "input" && (
            <div
              className={`mb-3 flex items-center gap-2 typo-caption rounded-md px-3 py-2 border ${
                sidecarFound
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                  : "border-primary/10 bg-secondary/30 text-foreground/60"
              }`}
            >
              <Search className="w-3.5 h-3.5 flex-shrink-0" />
              {sidecarFound
                ? `${entry.name}.sig.json auto-loaded from this folder.`
                : `No ${entry.name}.sig.json sibling found. Paste the signature below.`}
            </div>
          )}

          {/* Sidecar input */}
          {phase !== "done" && (
            <div>
              <label className="typo-caption-sm text-foreground/50 uppercase tracking-wide block mb-1">
                {t.plugins.doc_signing.signature_label}
              </label>
              <textarea
                value={sidecarJson}
                onChange={(e) => setSidecarJson(e.target.value)}
                rows={6}
                spellCheck={false}
                className="w-full px-3 py-2 rounded-md bg-secondary/40 border border-primary/15 typo-caption-sm font-mono text-foreground placeholder:text-foreground/40 focus:outline-none focus:ring-1 focus:ring-sky-500/50 resize-none"
                placeholder={"{\n  \"version\": 1,\n  \"algorithm\": \"Ed25519\",\n  ...\n}"}
              />
            </div>
          )}

          {/* Verify result */}
          {phase === "done" && result && <VerifyResultCard result={result} />}
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-primary/10">
          {phase === "done" ? (
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded-md bg-sky-500/20 text-sky-300 border border-sky-500/30 typo-caption font-medium hover:bg-sky-500/30 transition-colors"
            >
              {t.plugins.drive.confirm}
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={onClose}
                disabled={phase === "verifying"}
                className="px-3 py-1.5 rounded-md typo-caption font-medium text-foreground/70 hover:bg-secondary/50 disabled:opacity-50 transition-colors"
              >
                {t.plugins.drive.cancel}
              </button>
              <button
                type="button"
                onClick={handleVerify}
                disabled={phase === "verifying" || !sidecarJson.trim()}
                className="px-3 py-1.5 rounded-md bg-sky-500/20 text-sky-300 border border-sky-500/30 typo-caption font-medium hover:bg-sky-500/30 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {phase === "verifying"
                  ? t.plugins.doc_signing.verifying
                  : t.plugins.doc_signing.verify_signature}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function VerifyResultCard({ result }: { result: VerifyDocumentResult }) {
  const { t } = useTranslation();
  const isValid = result.valid;
  const Icon = isValid ? CheckCircle2 : XCircle;

  return (
    <div
      className={`rounded-lg border p-3 ${
        isValid
          ? "border-emerald-500/30 bg-emerald-500/10"
          : "border-rose-500/30 bg-rose-500/10"
      }`}
    >
      <div className="flex items-center gap-2 mb-3">
        <Icon
          className={`w-5 h-5 ${isValid ? "text-emerald-400" : "text-rose-400"}`}
        />
        <span
          className={`typo-body font-semibold ${
            isValid ? "text-emerald-300" : "text-rose-300"
          }`}
        >
          {isValid
            ? t.plugins.doc_signing.valid_signature
            : t.plugins.doc_signing.verification_failed}
        </span>
      </div>

      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 typo-caption">
        <dt className="text-foreground/50">{t.plugins.doc_signing.signer}</dt>
        <dd className="text-foreground/90 truncate">
          {result.signer_display_name}
        </dd>

        <dt className="text-foreground/50">
          {t.plugins.doc_signing.signed_at}
        </dt>
        <dd className="text-foreground/90">
          {new Date(result.signed_at).toLocaleString()}
        </dd>

        <dt className="text-foreground/50">
          {t.plugins.doc_signing.file_integrity}
        </dt>
        <dd
          className={
            result.file_hash_match ? "text-emerald-300" : "text-rose-300"
          }
        >
          {result.file_hash_match
            ? t.plugins.doc_signing.unchanged
            : t.plugins.doc_signing.modified}
        </dd>

        <dt className="text-foreground/50">
          {t.plugins.doc_signing.crypto_signature}
        </dt>
        <dd
          className={
            result.signature_valid ? "text-emerald-300" : "text-rose-300"
          }
        >
          {result.signature_valid
            ? t.plugins.doc_signing.valid
            : t.plugins.doc_signing.invalid}
        </dd>
      </dl>

      {result.error && (
        <div className="mt-3 px-2 py-1.5 rounded bg-rose-500/15 typo-caption-sm text-rose-300 font-mono">
          {result.error}
        </div>
      )}
    </div>
  );
}
