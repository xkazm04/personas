import { useState } from 'react';
import { Download, Loader2, ShieldCheck, ShieldAlert, ShieldOff, AlertTriangle, Check } from 'lucide-react';
import { open } from '@tauri-apps/plugin-dialog';
import { BaseModal } from '@/lib/ui/BaseModal';
import { usePersonaStore } from '@/stores/personaStore';
import { useToastStore } from '@/stores/toastStore';
import type { BundleImportPreview, BundleResourcePreview } from '@/api/network/bundle';

type Phase = 'pick' | 'previewing' | 'preview' | 'importing' | 'done';

interface BundleImportDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export function BundleImportDialog({ isOpen, onClose }: BundleImportDialogProps) {
  const previewBundleImport = usePersonaStore((s) => s.previewBundleImport);
  const applyBundleImport = usePersonaStore((s) => s.applyBundleImport);
  const addToast = useToastStore((s) => s.addToast);

  const [phase, setPhase] = useState<Phase>('pick');
  const [filePath, setFilePath] = useState<string | null>(null);
  const [preview, setPreview] = useState<BundleImportPreview | null>(null);
  const [skipConflicts, setSkipConflicts] = useState(true);
  const [renamePrefix, setRenamePrefix] = useState('');
  const [importResult, setImportResult] = useState<{ imported: number; skipped: number; errors: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setPhase('pick');
    setFilePath(null);
    setPreview(null);
    setSkipConflicts(true);
    setRenamePrefix('');
    setImportResult(null);
    setError(null);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handlePickFile = async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: 'Persona Bundle', extensions: ['persona'] }],
      });
      if (!selected) return; // cancelled

      const path = typeof selected === 'string' ? selected : selected;
      setFilePath(path);
      setPhase('previewing');
      setError(null);

      const p = await previewBundleImport(path);
      setPreview(p);
      setPhase('preview');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load bundle');
      setPhase('pick');
    }
  };

  const handleImport = async () => {
    if (!filePath) return;
    setPhase('importing');
    try {
      const result = await applyBundleImport(filePath, {
        skip_conflicts: skipConflicts,
        rename_prefix: renamePrefix || null,
      });
      setImportResult(result);
      setPhase('done');
      addToast(`Imported ${result.imported} resource${result.imported !== 1 ? 's' : ''}`, 'success');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to import bundle');
      setPhase('preview');
    }
  };

  return (
    <BaseModal isOpen={isOpen} onClose={handleClose} titleId="bundle-import-title" maxWidthClass="max-w-lg">
      <div className="p-5 space-y-4">
        <div>
          <h2 id="bundle-import-title" className="text-base font-semibold text-foreground flex items-center gap-2">
            <Download className="w-4.5 h-4.5 text-emerald-400" />
            Import Bundle
          </h2>
          <p className="text-xs text-muted-foreground mt-1">
            Import a signed .persona bundle from a trusted peer.
          </p>
        </div>

        {error && (
          <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-3 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0" />
            <span className="text-xs text-red-400">{error}</span>
          </div>
        )}

        {/* Phase: Pick file */}
        {phase === 'pick' && (
          <div className="rounded-xl border border-dashed border-border p-8 text-center">
            <Download className="w-8 h-8 mx-auto mb-3 text-muted-foreground/40" />
            <button
              onClick={handlePickFile}
              className="px-4 py-2 text-sm rounded-lg bg-primary text-white hover:bg-primary/90"
            >
              Choose .persona file
            </button>
            <p className="text-xs text-muted-foreground mt-2">
              Select a .persona bundle file to preview and import.
            </p>
          </div>
        )}

        {/* Phase: Previewing (loading) */}
        {phase === 'previewing' && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
            <Loader2 className="w-4 h-4 animate-spin" />
            Verifying bundle...
          </div>
        )}

        {/* Phase: Preview */}
        {phase === 'preview' && preview && (
          <BundlePreviewContent
            preview={preview}
            skipConflicts={skipConflicts}
            setSkipConflicts={setSkipConflicts}
            renamePrefix={renamePrefix}
            setRenamePrefix={setRenamePrefix}
          />
        )}

        {/* Phase: Importing */}
        {phase === 'importing' && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
            <Loader2 className="w-4 h-4 animate-spin" />
            Importing resources...
          </div>
        )}

        {/* Phase: Done */}
        {phase === 'done' && importResult && (
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium text-emerald-400">
              <Check className="w-4 h-4" />
              Import Complete
            </div>
            <div className="text-xs text-muted-foreground space-y-0.5">
              <p>{importResult.imported} resource{importResult.imported !== 1 ? 's' : ''} imported</p>
              {importResult.skipped > 0 && (
                <p>{importResult.skipped} skipped (conflicts)</p>
              )}
              {importResult.errors.length > 0 && (
                <div className="mt-2">
                  <p className="text-red-400">{importResult.errors.length} error{importResult.errors.length !== 1 ? 's' : ''}:</p>
                  {importResult.errors.map((e, i) => (
                    <p key={i} className="text-red-400/80 ml-2">- {e}</p>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="flex justify-end gap-2 pt-2 border-t border-border">
          <button
            onClick={handleClose}
            className="px-3 py-1.5 text-xs rounded-lg border border-border hover:bg-secondary/50"
          >
            {phase === 'done' ? 'Close' : 'Cancel'}
          </button>
          {phase === 'preview' && (
            <button
              onClick={handleImport}
              className="px-3 py-1.5 text-xs rounded-lg bg-primary text-white hover:bg-primary/90 flex items-center gap-1.5"
            >
              <Download className="w-3.5 h-3.5" />
              Import
            </button>
          )}
        </div>
      </div>
    </BaseModal>
  );
}

function BundlePreviewContent({
  preview,
  skipConflicts,
  setSkipConflicts,
  renamePrefix,
  setRenamePrefix,
}: {
  preview: BundleImportPreview;
  skipConflicts: boolean;
  setSkipConflicts: (v: boolean) => void;
  renamePrefix: string;
  setRenamePrefix: (v: string) => void;
}) {
  const hasConflicts = preview.resources.some((r) => r.conflict);

  return (
    <div className="space-y-3">
      {/* Signer info */}
      <div className="rounded-lg border border-border bg-secondary/10 p-3 space-y-2">
        <div className="flex items-center gap-2">
          {preview.signature_valid ? (
            preview.signer_trusted ? (
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
            ) : (
              <ShieldAlert className="w-4 h-4 text-amber-400" />
            )
          ) : (
            <ShieldOff className="w-4 h-4 text-red-400" />
          )}
          <div>
            <div className="text-sm font-medium text-foreground">{preview.signer_display_name}</div>
            <div className="text-[10px] text-muted-foreground font-mono">
              {preview.signer_peer_id.slice(0, 8)}...{preview.signer_peer_id.slice(-8)}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3 text-[10px]">
          <span className={`px-1.5 py-0.5 rounded-full ${
            preview.signature_valid
              ? 'bg-emerald-500/10 text-emerald-400'
              : 'bg-red-500/10 text-red-400'
          }`}>
            {preview.signature_valid ? 'Signature valid' : 'Invalid signature'}
          </span>
          <span className={`px-1.5 py-0.5 rounded-full ${
            preview.signer_trusted
              ? 'bg-emerald-500/10 text-emerald-400'
              : 'bg-amber-500/10 text-amber-400'
          }`}>
            {preview.signer_trusted ? 'Trusted peer' : 'Unknown peer'}
          </span>
        </div>
      </div>

      {/* Warning for untrusted signer */}
      {!preview.signer_trusted && preview.signature_valid && (
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-2.5 flex items-start gap-2">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-400 mt-0.5 flex-shrink-0" />
          <span className="text-xs text-amber-400/90">
            This bundle is from an unknown peer. Add them as a trusted peer first for verified imports.
          </span>
        </div>
      )}

      {/* Resources list */}
      <div>
        <div className="text-xs text-muted-foreground mb-1.5">
          {preview.resources.length} resource{preview.resources.length !== 1 ? 's' : ''} in bundle
        </div>
        <div className="max-h-[30vh] overflow-y-auto space-y-1 pr-1">
          {preview.resources.map((resource) => (
            <ResourcePreviewItem key={resource.resource_id} resource={resource} />
          ))}
        </div>
      </div>

      {/* Conflict options */}
      {hasConflicts && (
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 space-y-2">
          <div className="text-xs text-amber-400 font-medium">Naming conflicts detected</div>
          <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={skipConflicts}
              onChange={(e) => setSkipConflicts(e.target.checked)}
              className="rounded border-border"
            />
            Skip conflicting resources
          </label>
          {!skipConflicts && (
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Rename prefix</label>
              <input
                value={renamePrefix}
                onChange={(e) => setRenamePrefix(e.target.value)}
                placeholder="e.g. imported-"
                className="w-full px-2 py-1 text-xs rounded-lg border border-border bg-background focus:outline-none focus:ring-1 focus:ring-primary/40"
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ResourcePreviewItem({ resource }: { resource: BundleResourcePreview }) {
  return (
    <div className={`rounded-lg border p-2 flex items-center gap-2 ${
      resource.conflict
        ? 'border-amber-500/20 bg-amber-500/5'
        : 'border-border bg-secondary/10'
    }`}>
      <div className="min-w-0 flex-1">
        <div className="text-sm text-foreground truncate">{resource.display_name}</div>
        <div className="text-[10px] text-muted-foreground flex items-center gap-1.5">
          <span>{resource.resource_type}</span>
          <span className="text-muted-foreground/40">·</span>
          <span>{resource.access_level}</span>
        </div>
      </div>
      {resource.conflict && (
        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-400 flex-shrink-0">
          conflict
        </span>
      )}
    </div>
  );
}
