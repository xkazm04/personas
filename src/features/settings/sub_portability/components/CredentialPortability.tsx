import {
  ShieldCheck,
  KeyRound,
  Upload,
  Download,
  PackageCheck,
  Check,
} from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import type { CredentialImportResult } from '@/api/system/dataPortability';

type Status = 'idle' | 'loading' | 'success' | 'error';

interface CredentialPortabilityProps {
  credExportStatus: Status;
  credImportStatus: Status;
  credImportResult: CredentialImportResult | null;
  credExportPassphrase: string;
  setCredExportPassphrase: (v: string) => void;
  credImportPassphrase: string;
  setCredImportPassphrase: (v: string) => void;
  showCredExportInput: boolean;
  setShowCredExportInput: (v: boolean) => void;
  showCredImportInput: boolean;
  setShowCredImportInput: (v: boolean) => void;
  onCredExport: () => void;
  onCredImport: () => void;
}

export function CredentialPortability({
  credExportStatus,
  credImportStatus,
  credImportResult,
  credExportPassphrase,
  setCredExportPassphrase,
  credImportPassphrase,
  setCredImportPassphrase,
  showCredExportInput,
  setShowCredExportInput,
  showCredImportInput,
  setShowCredImportInput,
  onCredExport,
  onCredImport,
}: CredentialPortabilityProps) {
  return (
    <div className="rounded-xl border border-primary/10 bg-card-bg p-6 space-y-4">
      <h2 className="text-sm font-mono text-muted-foreground/90 uppercase tracking-wider">
        Credential Vault
      </h2>
      <div className="flex items-start gap-2 text-sm text-muted-foreground/70">
        <ShieldCheck className="w-4 h-4 mt-0.5 flex-shrink-0 text-amber-400/70" />
        <p>
          Workspace exports do not include credential secrets. Use this section to
          export and import your vault with password-protected AES-256 encryption.
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        {/* Export credentials */}
        <div className="space-y-2">
          {!showCredExportInput ? (
            <button
              onClick={() => setShowCredExportInput(true)}
              disabled={credExportStatus === 'loading'}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium
                bg-amber-500/10 text-amber-400 border border-amber-500/20 hover:bg-amber-500/15
                transition-colors disabled:opacity-50"
            >
              {credExportStatus === 'success' ? (
                <Check className="w-4 h-4" />
              ) : (
                <KeyRound className="w-4 h-4" />
              )}
              {credExportStatus === 'success' ? 'Exported!' : 'Export Credentials'}
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <input
                type="password"
                placeholder="Passphrase (min 8 chars)"
                value={credExportPassphrase}
                onChange={(e) => setCredExportPassphrase(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && onCredExport()}
                className="px-3 py-2 rounded-lg border border-primary/15 bg-secondary/20 text-sm
                  text-foreground/90 placeholder:text-muted-foreground/40 outline-none
                  focus-visible:border-amber-500/30 w-56"
                autoFocus
              />
              <button
                onClick={onCredExport}
                disabled={credExportStatus === 'loading'}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium
                  bg-amber-500/10 text-amber-400 border border-amber-500/20 hover:bg-amber-500/15
                  transition-colors disabled:opacity-50"
              >
                {credExportStatus === 'loading' ? (
                  <LoadingSpinner />
                ) : (
                  <Download className="w-4 h-4" />
                )}
                Export
              </button>
              <button
                onClick={() => { setShowCredExportInput(false); setCredExportPassphrase(''); }}
                className="text-xs text-muted-foreground/50 hover:text-muted-foreground/80 transition-colors"
              >
                Cancel
              </button>
            </div>
          )}
        </div>

        {/* Import credentials */}
        <div className="space-y-2">
          {!showCredImportInput ? (
            <button
              onClick={() => setShowCredImportInput(true)}
              disabled={credImportStatus === 'loading'}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium
                bg-blue-500/10 text-blue-400 border border-blue-500/20 hover:bg-blue-500/15
                transition-colors disabled:opacity-50"
            >
              {credImportStatus === 'success' ? (
                <Check className="w-4 h-4" />
              ) : (
                <Upload className="w-4 h-4" />
              )}
              {credImportStatus === 'success' ? 'Imported!' : 'Import Credentials'}
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <input
                type="password"
                placeholder="Passphrase"
                value={credImportPassphrase}
                onChange={(e) => setCredImportPassphrase(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && onCredImport()}
                className="px-3 py-2 rounded-lg border border-primary/15 bg-secondary/20 text-sm
                  text-foreground/90 placeholder:text-muted-foreground/40 outline-none
                  focus-visible:border-blue-500/30 w-56"
                autoFocus
              />
              <button
                onClick={onCredImport}
                disabled={credImportStatus === 'loading'}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium
                  bg-blue-500/10 text-blue-400 border border-blue-500/20 hover:bg-blue-500/15
                  transition-colors disabled:opacity-50"
              >
                {credImportStatus === 'loading' ? (
                  <LoadingSpinner />
                ) : (
                  <Upload className="w-4 h-4" />
                )}
                Import
              </button>
              <button
                onClick={() => { setShowCredImportInput(false); setCredImportPassphrase(''); }}
                className="text-xs text-muted-foreground/50 hover:text-muted-foreground/80 transition-colors"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Import result */}
      {credImportResult && (
        <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-4 space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium text-emerald-400">
            <PackageCheck className="w-4 h-4" />
            Credential Import Complete
          </div>
          <p className="text-sm text-muted-foreground/80">
            {credImportResult.created} credential(s) imported
          </p>
          {credImportResult.warnings.length > 0 && (
            <div className="mt-2 space-y-1">
              <p className="text-sm font-medium text-amber-400">Warnings:</p>
              {credImportResult.warnings.map((w, i) => (
                <p key={i} className="text-sm text-muted-foreground/70 pl-2">
                  - {w}
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
