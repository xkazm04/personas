import { useEffect, useRef, useState } from 'react';
import { Download, ShieldOff, AlertTriangle, Lock, ClipboardPaste, Link2 } from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { open } from '@tauri-apps/plugin-dialog';
import { BaseModal } from '@/lib/ui/BaseModal';
import { useSystemStore } from "@/stores/systemStore";
import { useToastStore } from '@/stores/toastStore';
import type { BundleImportPreview } from '@/api/network/bundle';
import type { EnclaveVerifyResult } from '@/api/network/enclave';
import { EnclaveVerificationView } from './EnclaveVerificationView';
import { ImportSuccessCelebration } from './ImportSuccessCelebration';
import { BundlePreviewContent, type DangerConfirmKind } from './BundlePreviewContent';
import { createLogger } from "@/lib/log";
import { errMsg } from "@/stores/storeTypes";
import { useTranslation } from '@/i18n/useTranslation';

const logger = createLogger("bundle-import");

type Phase = 'pick' | 'previewing' | 'preview' | 'importing' | 'done';

interface BundleImportDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /** Pre-fill with a personas://share deep link URL and auto-start preview. */
  initialShareUrl?: string;
  /** Bumped by the parent on every share-link arrival. Distinct from the URL
   *  itself so identical URLs in succession still re-trigger auto-preview;
   *  React's setState bails on identical values, otherwise. Optional — when
   *  absent, the legacy URL-equality comparison is used. */
  shareLinkKey?: number;
}

export function BundleImportDialog({ isOpen, onClose, initialShareUrl, shareLinkKey }: BundleImportDialogProps) {
  const previewBundleImport = useSystemStore((s) => s.previewBundleImport);
  const previewBundleFromClipboard = useSystemStore((s) => s.previewBundleFromClipboard);
  const previewShareLink = useSystemStore((s) => s.previewShareLink);
  const applyBundleImport = useSystemStore((s) => s.applyBundleImport);
  const applyBundleFromClipboard = useSystemStore((s) => s.applyBundleFromClipboard);
  const importFromShareLink = useSystemStore((s) => s.importFromShareLink);
  const verifyEnclave = useSystemStore((s) => s.verifyEnclave);
  const addToast = useToastStore((s) => s.addToast);
  const { t, tx } = useTranslation();
  const st = t.sharing;

  const [phase, setPhase] = useState<Phase>('pick');
  const [filePath, setFilePath] = useState<string | null>(null);
  const [clipboardData, setClipboardData] = useState<string | null>(null);
  const [shareLinkUrl, setShareLinkUrl] = useState<string | null>(null);
  const [shareLinkInput, setShareLinkInput] = useState('');
  const [preview, setPreview] = useState<BundleImportPreview | null>(null);
  const [enclaveResult, setEnclaveResult] = useState<EnclaveVerifyResult | null>(null);
  const [skipConflicts, setSkipConflicts] = useState(true);
  const [renamePrefix, setRenamePrefix] = useState('');
  const [importResult, setImportResult] = useState<{ imported: number; skipped: number; errors: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Tagged with the kind of warning the user acknowledged so consent can't
  // silently carry over from one warning shape (tamper) to another (unknown
  // signer) when `signer_trusted` flips between preview re-fetches.
  const [dangerConfirmed, setDangerConfirmed] = useState<DangerConfirmKind>(null);

  const isEnclave = filePath?.endsWith('.enclave') ?? false;

  // Monotonic token: bumped on every reset so in-flight preview responses
  // from a prior open/share-link can be discarded instead of flashing stale
  // bundle metadata into a subsequent open.
  const requestTokenRef = useRef(0);
  const autoStartedRef = useRef<string | null>(null);
  const autoStartedKeyRef = useRef<number | null>(null);

  const reset = () => {
    requestTokenRef.current++;
    setPhase('pick');
    setFilePath(null);
    setClipboardData(null);
    setShareLinkUrl(null);
    setShareLinkInput('');
    setPreview(null);
    setEnclaveResult(null);
    setSkipConflicts(true);
    setRenamePrefix('');
    setImportResult(null);
    setError(null);
    setDangerConfirmed(null);
  };

  // If the danger context of the preview changes (bundle hash, signer trust,
  // or signature validity), drop any prior consent. Without this, a preview
  // re-fetch that flips `signer_trusted` could carry an old "tamper" consent
  // into a freshly-rendered "unknown signer" warning.
  useEffect(() => {
    setDangerConfirmed(null);
  }, [preview?.bundle_hash, preview?.signer_trusted, preview?.signature_valid]);

  // Reset on open (and whenever initialShareUrl OR the parent's shareLinkKey
  // changes while open) so the dialog never flashes a previous preview before
  // the new fetch completes. Re-arrival of the same URL is detected via the
  // key bump; without it, identical URLs in succession would fail to
  // re-trigger the auto-preview because React's setState short-circuits on
  // identical values.
  useEffect(() => {
    if (!isOpen) {
      autoStartedRef.current = null;
      autoStartedKeyRef.current = null;
      reset();
      return;
    }
    const urlChanged = autoStartedRef.current !== (initialShareUrl ?? null);
    const keyChanged = shareLinkKey !== undefined && autoStartedKeyRef.current !== shareLinkKey;
    if (urlChanged || keyChanged) {
      reset();
      autoStartedRef.current = initialShareUrl ?? null;
      autoStartedKeyRef.current = shareLinkKey ?? null;
      if (initialShareUrl) {
        setShareLinkInput(initialShareUrl);
        queueMicrotask(() => handleImportShareLink(initialShareUrl));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, initialShareUrl, shareLinkKey]);

  const handleClose = () => {
    reset();
    onClose();
  };

  const handlePickFile = async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [
          { name: 'Persona Bundle or Enclave', extensions: ['persona', 'enclave'] },
        ],
      });
      if (!selected) return;

      // `multiple: false` above guarantees Tauri's open() returns string | null;
      // the earlier `if (!selected) return` already narrowed away null.
      const path = selected;
      setFilePath(path);
      setPhase('previewing');
      setError(null);
      setEnclaveResult(null);

      const token = ++requestTokenRef.current;
      if (path.endsWith('.enclave')) {
        const result = await verifyEnclave(path);
        if (token !== requestTokenRef.current) return;
        setEnclaveResult(result);
        setPhase('preview');
      } else {
        const p = await previewBundleImport(path);
        if (token !== requestTokenRef.current) return;
        setPreview(p);
        setPhase('preview');
      }
    } catch (err) {
      const msg = errMsg(err, 'Failed to load file');
      logger.warn('Failed to load file', { error: msg });
      setError(msg);
      setPhase('pick');
    }
  };

  const handlePasteFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text || text.trim().length === 0) {
        setError(st.clipboard_empty);
        return;
      }

      const trimmed = text.trim();
      setClipboardData(trimmed);
      setFilePath(null);
      setPhase('previewing');
      setError(null);

      const token = ++requestTokenRef.current;
      const p = await previewBundleFromClipboard(trimmed);
      if (token !== requestTokenRef.current) return;
      setPreview(p);
      setPhase('preview');
    } catch (err) {
      const msg = errMsg(err, 'Failed to read clipboard');
      logger.warn('Failed to paste from clipboard', { error: msg });
      setError(msg);
      setClipboardData(null);
      setPhase('pick');
    }
  };

  const handleImportShareLink = async (urlOverride?: string) => {
    const url = (urlOverride ?? shareLinkInput).trim();
    if (!url) return;

    try {
      // Store the original URL (may be personas:// or http://) -- both are
      // handled transparently by the backend commands.
      setShareLinkUrl(url);
      setFilePath(null);
      setClipboardData(null);
      setPhase('previewing');
      setError(null);

      const token = ++requestTokenRef.current;
      const p = await previewShareLink(url);
      if (token !== requestTokenRef.current) return;
      setPreview(p);
      setPhase('preview');
    } catch (err) {
      const msg = errMsg(err, 'Failed to load share link');
      logger.warn('Failed to preview share link', { error: msg });
      setError(msg);
      setShareLinkUrl(null);
      setPhase('pick');
    }
  };

  const handleImport = async () => {
    if (!filePath && !clipboardData && !shareLinkUrl) return;
    setPhase('importing');
    try {
      const options = {
        skip_conflicts: skipConflicts,
        rename_prefix: renamePrefix || null,
        preview_id: preview?.preview_id ?? null,
        expected_bundle_hash: preview?.bundle_hash ?? null,
      };

      const result = shareLinkUrl
        ? await importFromShareLink(shareLinkUrl, options)
        : clipboardData
          ? await applyBundleFromClipboard(clipboardData, options)
          : await applyBundleImport(filePath!, options);

      setImportResult(result);
      setPhase('done');
      const importedKey = result.imported === 1 ? st.imported_resources_one : st.imported_resources_other;
      addToast(tx(importedKey, { count: result.imported }), 'success');
    } catch (err) {
      const msg = errMsg(err, 'Failed to import bundle');
      logger.warn('Failed to import bundle', { filePath, clipboard: !!clipboardData, error: msg });
      setError(msg);
      setPhase('preview');
    }
  };

  return (
    <BaseModal isOpen={isOpen} onClose={handleClose} titleId="bundle-import-title" maxWidthClass="max-w-lg">
      <div className="p-5 space-y-4">
        <div>
          <h2 id="bundle-import-title" className="typo-body-lg font-semibold text-foreground flex items-center gap-2">
            {isEnclave ? (
              <Lock className="w-4 h-4 text-violet-400" />
            ) : (
              <Download className="w-4 h-4 text-emerald-400" />
            )}
            {isEnclave ? st.verify_enclave_title : st.import_title}
          </h2>
          <p className="typo-caption text-foreground mt-1">
            {isEnclave
              ? st.verify_enclave_subtitle
              : st.import_subtitle}
          </p>
        </div>

        {error && (
          <div className="rounded-card border border-red-500/20 bg-red-500/5 p-3 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0" />
            <span className="typo-caption text-red-400">{error}</span>
          </div>
        )}

        {/* Phase: Pick file */}
        <div className={`grid transition-all duration-200 ease-in-out ${
          phase === 'pick' ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
        }`}>
          <div className="overflow-hidden">
            <div className="rounded-modal border border-dashed border-border p-8 text-center space-y-3">
              <Download className="w-8 h-8 mx-auto mb-1 text-foreground" />
              <div className="flex items-center justify-center gap-2">
                <button
                  onClick={handlePickFile}
                  className="px-4 py-2 typo-body rounded-card bg-primary text-white hover:bg-primary/90"
                >
                  {st.choose_file}
                </button>
                <button
                  onClick={handlePasteFromClipboard}
                  className="px-4 py-2 typo-body rounded-card border border-border hover:bg-secondary/50 transition-colors flex items-center gap-1.5"
                >
                  <ClipboardPaste className="w-4 h-4" />
                  {st.paste_from_clipboard}
                </button>
              </div>
              <div className="flex items-center gap-1.5 mt-2 w-full max-w-xs mx-auto">
                <div className="relative flex-1">
                  <Link2 className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-foreground" />
                  <input
                    type="text"
                    value={shareLinkInput}
                    onChange={(e) => setShareLinkInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleImportShareLink(); }}
                    placeholder={st.share_link_placeholder}
                    className="w-full pl-7 pr-2 py-1.5 typo-caption rounded-card border border-border bg-background focus-ring"
                  />
                </div>
                <button
                  onClick={() => handleImportShareLink()}
                  disabled={!shareLinkInput.trim()}
                  className="px-3 py-1.5 typo-caption rounded-card border border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/10 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                >
                  {st.open}
                </button>
              </div>
              <p className="typo-caption text-foreground mt-2">
                {st.import_pick_hint}
              </p>
            </div>
          </div>
        </div>

        {/* Phase: Previewing (loading) */}
        <div className={`grid transition-all duration-200 ease-in-out ${
          phase === 'previewing' ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
        }`}>
          <div className="overflow-hidden">
            <div className="flex items-center gap-2 typo-body text-foreground py-8 justify-center">
              <LoadingSpinner />
              {isEnclave ? st.verifying_enclave : st.verifying_bundle}
            </div>
          </div>
        </div>

        {/* Phase: Preview -- Enclave verification result */}
        {isEnclave && enclaveResult && (
          <div className={`grid transition-all duration-200 ease-in-out ${
            phase === 'preview' ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
          }`}>
            <div className="overflow-hidden">
              <EnclaveVerificationView result={enclaveResult} />
            </div>
          </div>
        )}

        {/* Phase: Preview -- Bundle */}
        {!isEnclave && (
          <div className={`grid transition-all duration-200 ease-in-out ${
            phase === 'preview' && preview ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
          }`}>
            <div className="overflow-hidden">
              {preview && (
                <BundlePreviewContent
                  preview={preview}
                  skipConflicts={skipConflicts}
                  setSkipConflicts={setSkipConflicts}
                  renamePrefix={renamePrefix}
                  setRenamePrefix={setRenamePrefix}
                  dangerConfirmed={dangerConfirmed}
                  setDangerConfirmed={setDangerConfirmed}
                />
              )}
            </div>
          </div>
        )}

        {/* Phase: Importing */}
        <div className={`grid transition-all duration-200 ease-in-out ${
          phase === 'importing' ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
        }`}>
          <div className="overflow-hidden">
            <div className="flex items-center gap-2 typo-body text-foreground py-8 justify-center">
              <LoadingSpinner />
              {st.importing_resources}
            </div>
          </div>
        </div>

        {/* Phase: Done */}
        <div className={`grid transition-all duration-200 ease-in-out ${
          phase === 'done' && importResult ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
        }`}>
          <div className="overflow-hidden">
            {importResult && <ImportSuccessCelebration importResult={importResult} />}
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 pt-2 border-t border-border">
          <button
            onClick={handleClose}
            className="px-3 py-1.5 typo-caption rounded-card border border-border hover:bg-secondary/50"
          >
            {phase === 'done' || isEnclave ? st.close : st.cancel}
          </button>
          {phase === 'preview' && !isEnclave && preview && (
            preview.signature_valid ? (
              <button
                onClick={handleImport}
                className="px-3 py-1.5 typo-caption rounded-card bg-primary text-white hover:bg-primary/90 flex items-center gap-1.5"
              >
                <Download className="w-3.5 h-3.5" />
                {st.import_btn}
              </button>
            ) : (() => {
              // Import is enabled only when the user has acknowledged the
              // SPECIFIC danger that the current preview surfaces. A 'tamper'
              // ack does not unlock 'unknown signer' or vice versa.
              const requiredKind: DangerConfirmKind = preview.signer_trusted ? 'tamper' : 'unknown';
              const matchedKind = dangerConfirmed === requiredKind;
              return (
                <button
                  onClick={matchedKind ? handleImport : undefined}
                  disabled={!matchedKind}
                  className="px-3 py-1.5 typo-caption rounded-card bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
                >
                  <ShieldOff className="w-3.5 h-3.5" />
                  {st.import_anyway}
                </button>
              );
            })()
          )}
        </div>
      </div>
    </BaseModal>
  );
}
