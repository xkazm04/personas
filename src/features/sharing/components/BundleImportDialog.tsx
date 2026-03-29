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
import { BundlePreviewContent } from './BundlePreviewContent';
import { createLogger } from "@/lib/log";

const logger = createLogger("bundle-import");

type Phase = 'pick' | 'previewing' | 'preview' | 'importing' | 'done';

interface BundleImportDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /** Pre-fill with a personas://share deep link URL and auto-start preview. */
  initialShareUrl?: string;
}

export function BundleImportDialog({ isOpen, onClose, initialShareUrl }: BundleImportDialogProps) {
  const previewBundleImport = useSystemStore((s) => s.previewBundleImport);
  const previewBundleFromClipboard = useSystemStore((s) => s.previewBundleFromClipboard);
  const previewShareLink = useSystemStore((s) => s.previewShareLink);
  const applyBundleImport = useSystemStore((s) => s.applyBundleImport);
  const applyBundleFromClipboard = useSystemStore((s) => s.applyBundleFromClipboard);
  const importFromShareLink = useSystemStore((s) => s.importFromShareLink);
  const verifyEnclave = useSystemStore((s) => s.verifyEnclave);
  const addToast = useToastStore((s) => s.addToast);

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
  const [dangerConfirmed, setDangerConfirmed] = useState(false);

  const isEnclave = filePath?.endsWith('.enclave') ?? false;

  // Auto-start share link preview when opened with an initialShareUrl
  const autoStartedRef = useRef<string | null>(null);
  useEffect(() => {
    if (isOpen && initialShareUrl && autoStartedRef.current !== initialShareUrl) {
      autoStartedRef.current = initialShareUrl;
      setShareLinkInput(initialShareUrl);
      // Defer to next tick so dialog is fully mounted
      queueMicrotask(() => handleImportShareLink(initialShareUrl));
    }
    if (!isOpen) {
      autoStartedRef.current = null;
    }
  }, [isOpen, initialShareUrl]);

  const reset = () => {
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
    setDangerConfirmed(false);
  };

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

      const path = typeof selected === 'string' ? selected : selected;
      setFilePath(path);
      setPhase('previewing');
      setError(null);
      setEnclaveResult(null);

      if (path.endsWith('.enclave')) {
        const result = await verifyEnclave(path);
        setEnclaveResult(result);
        setPhase('preview');
      } else {
        const p = await previewBundleImport(path);
        setPreview(p);
        setPhase('preview');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn('Failed to load file', { error: msg });
      setError(msg || 'Failed to load file');
      setPhase('pick');
    }
  };

  const handlePasteFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text || text.trim().length === 0) {
        setError('Clipboard is empty');
        return;
      }

      const trimmed = text.trim();
      setClipboardData(trimmed);
      setFilePath(null);
      setPhase('previewing');
      setError(null);

      const p = await previewBundleFromClipboard(trimmed);
      setPreview(p);
      setPhase('preview');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn('Failed to paste from clipboard', { error: msg });
      setError(msg || 'Failed to read clipboard');
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

      const p = await previewShareLink(url);
      setPreview(p);
      setPhase('preview');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn('Failed to preview share link', { error: msg });
      setError(msg || 'Failed to load share link');
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
      addToast(`Imported ${result.imported} resource${result.imported !== 1 ? 's' : ''}`, 'success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn('Failed to import bundle', { filePath, clipboard: !!clipboardData, error: msg });
      setError(msg || 'Failed to import bundle');
      setPhase('preview');
    }
  };

  return (
    <BaseModal isOpen={isOpen} onClose={handleClose} titleId="bundle-import-title" maxWidthClass="max-w-lg">
      <div className="p-5 space-y-4">
        <div>
          <h2 id="bundle-import-title" className="text-base font-semibold text-foreground flex items-center gap-2">
            {isEnclave ? (
              <Lock className="w-4.5 h-4.5 text-violet-400" />
            ) : (
              <Download className="w-4.5 h-4.5 text-emerald-400" />
            )}
            {isEnclave ? 'Verify Enclave' : 'Import Bundle'}
          </h2>
          <p className="text-xs text-muted-foreground mt-1">
            {isEnclave
              ? 'Verify a sealed persona enclave from a trusted creator.'
              : 'Import a signed .persona bundle from a trusted peer.'}
          </p>
        </div>

        {error && (
          <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-3 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0" />
            <span className="text-xs text-red-400">{error}</span>
          </div>
        )}

        {/* Phase: Pick file */}
        <div className={`grid transition-all duration-200 ease-in-out ${
          phase === 'pick' ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
        }`}>
          <div className="overflow-hidden">
            <div className="rounded-xl border border-dashed border-border p-8 text-center space-y-3">
              <Download className="w-8 h-8 mx-auto mb-1 text-muted-foreground/40" />
              <div className="flex items-center justify-center gap-2">
                <button
                  onClick={handlePickFile}
                  className="px-4 py-2 text-sm rounded-lg bg-primary text-white hover:bg-primary/90"
                >
                  Choose file
                </button>
                <button
                  onClick={handlePasteFromClipboard}
                  className="px-4 py-2 text-sm rounded-lg border border-border hover:bg-secondary/50 transition-colors flex items-center gap-1.5"
                >
                  <ClipboardPaste className="w-4 h-4" />
                  Paste from Clipboard
                </button>
              </div>
              <div className="flex items-center gap-1.5 mt-2 w-full max-w-xs mx-auto">
                <div className="relative flex-1">
                  <Link2 className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground/50" />
                  <input
                    type="text"
                    value={shareLinkInput}
                    onChange={(e) => setShareLinkInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleImportShareLink(); }}
                    placeholder="Paste share link or personas:// URL..."
                    className="w-full pl-7 pr-2 py-1.5 text-xs rounded-lg border border-border bg-background focus-ring"
                  />
                </div>
                <button
                  onClick={() => handleImportShareLink()}
                  disabled={!shareLinkInput.trim()}
                  className="px-3 py-1.5 text-xs rounded-lg border border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/10 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                >
                  Open
                </button>
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                Choose a file, paste clipboard data, or use a share link (personas:// deep link) from another Personas instance.
              </p>
            </div>
          </div>
        </div>

        {/* Phase: Previewing (loading) */}
        <div className={`grid transition-all duration-200 ease-in-out ${
          phase === 'previewing' ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
        }`}>
          <div className="overflow-hidden">
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
              <LoadingSpinner />
              {isEnclave ? 'Verifying enclave...' : 'Verifying bundle...'}
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
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
              <LoadingSpinner />
              Importing resources...
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
            className="px-3 py-1.5 text-xs rounded-lg border border-border hover:bg-secondary/50"
          >
            {phase === 'done' || isEnclave ? 'Close' : 'Cancel'}
          </button>
          {phase === 'preview' && !isEnclave && preview && (
            preview.signature_valid ? (
              <button
                onClick={handleImport}
                className="px-3 py-1.5 text-xs rounded-lg bg-primary text-white hover:bg-primary/90 flex items-center gap-1.5"
              >
                <Download className="w-3.5 h-3.5" />
                Import
              </button>
            ) : (
              <button
                onClick={dangerConfirmed ? handleImport : undefined}
                disabled={!dangerConfirmed}
                className="px-3 py-1.5 text-xs rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
              >
                <ShieldOff className="w-3.5 h-3.5" />
                Import Anyway
              </button>
            )
          )}
        </div>
      </div>
    </BaseModal>
  );
}
