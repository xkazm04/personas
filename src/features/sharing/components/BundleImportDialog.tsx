import { useState, useEffect } from 'react';
import { Download, Loader2, ShieldCheck, ShieldAlert, ShieldOff, AlertTriangle } from 'lucide-react';
import { open } from '@tauri-apps/plugin-dialog';
import { BaseModal } from '@/lib/ui/BaseModal';
import { useSystemStore } from "@/stores/systemStore";
import { useToastStore } from '@/stores/toastStore';
import type { BundleImportPreview, BundleResourcePreview } from '@/api/network/bundle';

type Phase = 'pick' | 'previewing' | 'preview' | 'importing' | 'done';

interface BundleImportDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export function BundleImportDialog({ isOpen, onClose }: BundleImportDialogProps) {
  const previewBundleImport = useSystemStore((s) => s.previewBundleImport);
  const applyBundleImport = useSystemStore((s) => s.applyBundleImport);
  const addToast = useToastStore((s) => s.addToast);

  const [phase, setPhase] = useState<Phase>('pick');
  const [filePath, setFilePath] = useState<string | null>(null);
  const [preview, setPreview] = useState<BundleImportPreview | null>(null);
  const [skipConflicts, setSkipConflicts] = useState(true);
  const [renamePrefix, setRenamePrefix] = useState('');
  const [importResult, setImportResult] = useState<{ imported: number; skipped: number; errors: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dangerConfirmed, setDangerConfirmed] = useState(false);

  const reset = () => {
    setPhase('pick');
    setFilePath(null);
    setPreview(null);
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
      const msg = err instanceof Error ? err.message : String(err);
      console.warn('[BundleImportDialog] Failed to load bundle', { error: msg });
      setError(msg || 'Failed to load bundle');
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
        preview_id: preview?.preview_id ?? null,
      });
      setImportResult(result);
      setPhase('done');
      addToast(`Imported ${result.imported} resource${result.imported !== 1 ? 's' : ''}`, 'success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn('[BundleImportDialog] Failed to import bundle', { filePath, error: msg });
      setError(msg || 'Failed to import bundle');
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
        <div className={`grid transition-all duration-200 ease-in-out ${
          phase === 'pick' ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
        }`}>
          <div className="overflow-hidden">
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
          </div>
        </div>

        {/* Phase: Previewing (loading) */}
        <div className={`grid transition-all duration-200 ease-in-out ${
          phase === 'previewing' ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
        }`}>
          <div className="overflow-hidden">
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
              <Loader2 className="w-4 h-4 animate-spin" />
              Verifying bundle...
            </div>
          </div>
        </div>

        {/* Phase: Preview */}
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

        {/* Phase: Importing */}
        <div className={`grid transition-all duration-200 ease-in-out ${
          phase === 'importing' ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
        }`}>
          <div className="overflow-hidden">
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
              <Loader2 className="w-4 h-4 animate-spin" />
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
            {phase === 'done' ? 'Close' : 'Cancel'}
          </button>
          {phase === 'preview' && preview && (
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

const CONFETTI_COLORS = ['#34d399', '#06b6d4', '#10b981', '#22d3ee', '#6ee7b7', '#67e8f9'];

function ConfettiParticle({ index }: { index: number }) {
  const color = CONFETTI_COLORS[index % CONFETTI_COLORS.length];
  const left = 10 + (index * 17) % 80;
  const delay = (index * 70) % 400;
  const size = 4 + (index % 3) * 2;
  const rotation = (index * 47) % 360;

  return (
    <rect
      x={left}
      y={-10}
      width={size}
      height={size * 0.6}
      rx={1}
      fill={color}
      opacity={0.85}
      transform={`rotate(${rotation} ${left + size / 2} ${-10 + size * 0.3})`}
    >
      <animateTransform
        attributeName="transform"
        type="translate"
        values={`0 0; ${(index % 2 ? 8 : -8)} 90; ${(index % 2 ? -4 : 12)} 140`}
        dur="1.2s"
        begin={`${delay}ms`}
        fill="freeze"
        additive="sum"
      />
      <animate
        attributeName="opacity"
        values="0;0.85;0.85;0"
        keyTimes="0;0.1;0.7;1"
        dur="1.2s"
        begin={`${delay}ms`}
        fill="freeze"
      />
      <animateTransform
        attributeName="transform"
        type="rotate"
        values={`0 ${left + size / 2} ${-10 + size * 0.3}; ${360 + rotation} ${left + size / 2} ${60}`}
        dur="1.2s"
        begin={`${delay}ms`}
        fill="freeze"
        additive="sum"
      />
    </rect>
  );
}

function PackageUnwrapSvg() {
  return (
    <svg
      viewBox="0 0 160 120"
      width={160}
      height={120}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="mx-auto"
      aria-hidden="true"
    >
      {/* Confetti particles */}
      {Array.from({ length: 8 }, (_, i) => (
        <ConfettiParticle key={i} index={i} />
      ))}

      {/* Package base */}
      <g>
        <rect x="45" y="50" width="70" height="50" rx="6" fill="#064e3b" stroke="#34d399" strokeWidth="1.5">
          <animate attributeName="opacity" values="0;1" dur="0.3s" fill="freeze" />
        </rect>
        {/* Vertical ribbon */}
        <rect x="76" y="50" width="8" height="50" fill="#10b981" opacity="0.4">
          <animate attributeName="opacity" values="0;0.4" dur="0.3s" fill="freeze" />
        </rect>
        {/* Horizontal ribbon */}
        <rect x="45" y="70" width="70" height="8" fill="#10b981" opacity="0.4">
          <animate attributeName="opacity" values="0;0.4" dur="0.3s" fill="freeze" />
        </rect>
        {/* Ribbon bow center */}
        <circle cx="80" cy="50" r="5" fill="#34d399">
          <animate attributeName="opacity" values="0;1" dur="0.3s" fill="freeze" />
        </circle>
      </g>

      {/* Lid lifting off */}
      <g>
        <rect x="42" y="44" width="76" height="14" rx="4" fill="#065f46" stroke="#34d399" strokeWidth="1.5">
          <animate attributeName="opacity" values="0;1" dur="0.3s" fill="freeze" />
          <animateTransform
            attributeName="transform"
            type="translate"
            values="0 0; 0 -18"
            dur="0.5s"
            begin="0.15s"
            fill="freeze"
          />
          <animate
            attributeName="opacity"
            values="1;1;0"
            keyTimes="0;0.6;1"
            dur="0.6s"
            begin="0.15s"
            fill="freeze"
          />
        </rect>
        {/* Lid ribbon */}
        <rect x="76" y="44" width="8" height="14" fill="#10b981" opacity="0.4">
          <animateTransform
            attributeName="transform"
            type="translate"
            values="0 0; 0 -18"
            dur="0.5s"
            begin="0.15s"
            fill="freeze"
          />
          <animate
            attributeName="opacity"
            values="0.4;0.4;0"
            keyTimes="0;0.6;1"
            dur="0.6s"
            begin="0.15s"
            fill="freeze"
          />
        </rect>
      </g>

      {/* Checkmark emerging from box */}
      <g>
        <circle cx="80" cy="62" r="14" fill="#059669" opacity="0">
          <animate attributeName="opacity" values="0;0;1" keyTimes="0;0.5;1" dur="0.8s" begin="0.3s" fill="freeze" />
          <animateTransform
            attributeName="transform"
            type="translate"
            values="0 10; 0 -12"
            dur="0.5s"
            begin="0.45s"
            fill="freeze"
          />
        </circle>
        <path
          d="M73 62 L78 67 L88 57"
          stroke="white"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity="0"
        >
          <animate attributeName="opacity" values="0;0;1" keyTimes="0;0.5;1" dur="0.8s" begin="0.3s" fill="freeze" />
          <animateTransform
            attributeName="transform"
            type="translate"
            values="0 10; 0 -12"
            dur="0.5s"
            begin="0.45s"
            fill="freeze"
          />
        </path>
      </g>

      {/* Sparkle accents */}
      {[[50, 30], [110, 28], [35, 55], [125, 52]].map(([cx, cy], i) => (
        <circle
          key={i}
          cx={cx}
          cy={cy}
          r={2}
          fill={i % 2 === 0 ? '#34d399' : '#22d3ee'}
          opacity="0"
        >
          <animate
            attributeName="opacity"
            values="0;0.8;0"
            dur="0.6s"
            begin={`${0.5 + i * 0.12}s`}
            fill="freeze"
          />
          <animate
            attributeName="r"
            values="0;3;1.5"
            dur="0.6s"
            begin={`${0.5 + i * 0.12}s`}
            fill="freeze"
          />
        </circle>
      ))}
    </svg>
  );
}

function ImportSuccessCelebration({ importResult }: { importResult: { imported: number; skipped: number; errors: string[] } }) {
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    const t = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(t);
  }, []);

  return (
    <div
      className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 space-y-3 overflow-hidden"
      style={{
        transform: entered ? 'scale(1)' : 'scale(0.85)',
        opacity: entered ? 1 : 0,
        transition: 'transform 600ms cubic-bezier(0.34,1.56,0.64,1), opacity 400ms ease-out',
      }}
    >
      <PackageUnwrapSvg />
      <div className="text-center space-y-1">
        <div className="text-sm font-medium text-emerald-400">
          Import Complete
        </div>
        <div className="text-xs text-muted-foreground space-y-0.5">
          <p>{importResult.imported} resource{importResult.imported !== 1 ? 's' : ''} imported</p>
          {importResult.skipped > 0 && (
            <p>{importResult.skipped} skipped (conflicts)</p>
          )}
          {importResult.errors.length > 0 && (
            <div className="mt-2 text-left">
              <p className="text-red-400">{importResult.errors.length} error{importResult.errors.length !== 1 ? 's' : ''}:</p>
              {importResult.errors.map((e, i) => (
                <p key={i} className="text-red-400/80 ml-2">- {e}</p>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function BundlePreviewContent({
  preview,
  skipConflicts,
  setSkipConflicts,
  renamePrefix,
  setRenamePrefix,
  dangerConfirmed,
  setDangerConfirmed,
}: {
  preview: BundleImportPreview;
  skipConflicts: boolean;
  setSkipConflicts: (v: boolean) => void;
  renamePrefix: string;
  setRenamePrefix: (v: string) => void;
  dangerConfirmed: boolean;
  setDangerConfirmed: (v: boolean) => void;
}) {
  const hasConflicts = preview.resources.some((r) => r.conflict);

  return (
    <div className="space-y-3">
      {/* Signer info */}
      <div className={`rounded-lg border p-3 space-y-2 ${
        !preview.signature_valid
          ? 'border-red-500/30 bg-red-500/5'
          : 'border-border bg-secondary/10'
      }`}>
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

      {/* Danger: invalid signature */}
      {!preview.signature_valid && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-3 space-y-2">
          <div className="flex items-start gap-2">
            <ShieldOff className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0" />
            <div className="text-xs text-red-400 space-y-1">
              <p className="font-medium">This bundle has an invalid or missing signature.</p>
              <p className="text-red-400/80">
                The contents may have been tampered with. Importing untrusted bundles could introduce
                malicious persona configurations. Only proceed if you fully trust the source.
              </p>
            </div>
          </div>
          <label className="flex items-center gap-2 text-xs text-red-400 cursor-pointer pt-1">
            <input
              type="checkbox"
              checked={dangerConfirmed}
              onChange={(e) => setDangerConfirmed(e.target.checked)}
              className="rounded border-red-500/40"
            />
            I understand the risks and want to import this unsigned bundle
          </label>
        </div>
      )}

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
