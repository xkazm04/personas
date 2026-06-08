import { useEffect, useState } from "react";
import { AbsoluteTime } from '@/features/shared/components/display/AbsoluteTime';
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
import { BaseModal } from "@/features/shared/components/modals";

import type { useSigning } from "./useSigning";

const TITLE_ID = "drive-verify-dialog-title";

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

    return () => {
      cancelled = true;
    };
  }, [entry.path, findSidecarInDrive]);

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
    <BaseModal
      isOpen
      onClose={onClose}
      titleId={TITLE_ID}
      portal
      maxWidthClass="max-w-none"
      panelClassName="w-[560px] max-h-[85vh] flex flex-col rounded-modal border border-primary/25 bg-background/95 shadow-elevation-3"
    >
      <div className="contents">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-primary/15">
          <ShieldCheck className="w-4 h-4 text-sky-300" />
          <div id={TITLE_ID} className="typo-section-title flex-1 truncate">
            {t.plugins.doc_signing.verify_heading}
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

          {/* Sidecar lookup status */}
          {sidecarFound !== null && phase === "input" && (
            <div
              className={`mb-3 flex items-center gap-2 typo-body rounded-input px-3 py-2 border ${
                sidecarFound
                  ? "border-emerald-500/35 bg-emerald-500/10 text-emerald-100"
                  : "border-primary/15 bg-secondary/30 text-foreground"
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
              <label className="typo-label text-foreground block mb-1.5">
                {t.plugins.doc_signing.signature_label}
              </label>
              <textarea
                value={sidecarJson}
                onChange={(e) => setSidecarJson(e.target.value)}
                rows={6}
                spellCheck={false}
                className="w-full px-3 py-2 rounded-input bg-secondary/40 border border-primary/20 typo-body font-mono text-foreground placeholder:text-foreground focus:outline-none focus:border-sky-500/50 focus:ring-2 focus:ring-sky-500/20 resize-none transition-colors"
                placeholder={"{\n  \"version\": 1,\n  \"algorithm\": \"Ed25519\",\n  ...\n}"}
              />
            </div>
          )}

          {/* Verify result */}
          {phase === "done" && result && <VerifyResultCard result={result} />}
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-primary/15">
          {phase === "done" ? (
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded-input bg-sky-500/25 text-sky-100 border border-sky-500/40 typo-body font-semibold hover:bg-sky-500/35 transition-colors focus-ring"
            >
              {t.plugins.drive.confirm}
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={onClose}
                disabled={phase === "verifying"}
                className="px-3 py-1.5 rounded-input typo-body font-medium text-foreground hover:bg-secondary/60 disabled:opacity-50 transition-colors focus-ring"
              >
                {t.plugins.drive.cancel}
              </button>
              <button
                type="button"
                onClick={handleVerify}
                disabled={phase === "verifying" || !sidecarJson.trim()}
                className="px-3 py-1.5 rounded-input bg-sky-500/25 text-sky-100 border border-sky-500/40 typo-body font-semibold hover:bg-sky-500/35 disabled:opacity-40 disabled:cursor-not-allowed transition-colors focus-ring"
              >
                {phase === "verifying"
                  ? t.plugins.doc_signing.verifying
                  : t.plugins.doc_signing.verify_signature}
              </button>
            </>
          )}
        </div>
      </div>
    </BaseModal>
  );
}

function VerifyResultCard({ result }: { result: VerifyDocumentResult }) {
  const { t } = useTranslation();
  const isValid = result.valid;
  const Icon = isValid ? CheckCircle2 : XCircle;

  return (
    <div
      className={`rounded-card border p-3 ${
        isValid
          ? "border-emerald-500/40 bg-emerald-500/10"
          : "border-rose-500/40 bg-rose-500/10"
      }`}
    >
      <div className="flex items-center gap-2 mb-3">
        <Icon
          className={`w-5 h-5 ${isValid ? "text-emerald-300" : "text-rose-300"}`}
        />
        <span
          className={`typo-body font-semibold ${
            isValid ? "text-emerald-100" : "text-rose-100"
          }`}
        >
          {isValid
            ? t.plugins.doc_signing.valid_signature
            : t.plugins.doc_signing.verification_failed}
        </span>
      </div>

      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 typo-body">
        <dt className="text-foreground">{t.plugins.doc_signing.signer}</dt>
        <dd className="text-foreground font-medium truncate">
          {result.signer_display_name}
        </dd>

        <dt className="text-foreground">
          {t.plugins.doc_signing.signed_at}
        </dt>
        <dd className="text-foreground tabular-nums">
          {<AbsoluteTime timestamp={result.signed_at} />}
        </dd>

        <dt className="text-foreground">
          {t.plugins.doc_signing.file_integrity}
        </dt>
        <dd
          className={`font-semibold ${
            result.file_hash_match ? "text-emerald-200" : "text-rose-200"
          }`}
        >
          {result.file_hash_match
            ? t.plugins.doc_signing.unchanged
            : t.plugins.doc_signing.modified}
        </dd>

        <dt className="text-foreground">
          {t.plugins.doc_signing.crypto_signature}
        </dt>
        <dd
          className={`font-semibold ${
            result.signature_valid ? "text-emerald-200" : "text-rose-200"
          }`}
        >
          {result.signature_valid
            ? t.plugins.doc_signing.valid
            : t.plugins.doc_signing.invalid}
        </dd>
      </dl>

      {result.error && (
        <div className="mt-3 px-2 py-1.5 rounded bg-rose-500/20 typo-body text-rose-100 font-mono">
          {result.error}
        </div>
      )}
    </div>
  );
}
