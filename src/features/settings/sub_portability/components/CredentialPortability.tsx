import { useState } from 'react';
import {
  ShieldCheck,
  KeyRound,
  Upload,
  Download,
  PackageCheck,
  Check,
  AlertTriangle,
} from 'lucide-react';
import { SectionHeading } from '@/features/shared/components/layout/SectionHeading';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import type { CredentialImportResult } from '@/api/system/dataPortability';
import { useTranslation } from '@/i18n/useTranslation';

type Status = 'idle' | 'loading' | 'success' | 'error';
type ConflictAction = 'skip' | 'replace' | 'keep_both';

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
  onCredImportWithResolutions?: (resolutions: Record<string, string>) => void;
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
  onCredImportWithResolutions,
}: CredentialPortabilityProps) {
  const [resolutions, setResolutions] = useState<Record<string, ConflictAction>>({});
  const { t } = useTranslation();
  const s = t.settings.portability;
  const conflicts = credImportResult?.conflicts ?? [];
  const hasConflicts = conflicts.length > 0;

  const setResolution = (name: string, action: ConflictAction) => {
    setResolutions((prev) => ({ ...prev, [name]: action }));
  };

  const allResolved = hasConflicts && conflicts.every((c) => resolutions[c.name]);

  const handleApplyResolutions = () => {
    if (!allResolved || !onCredImportWithResolutions) return;
    onCredImportWithResolutions(resolutions);
    setResolutions({});
  };

  return (
    <div className="rounded-modal border border-primary/10 bg-card-bg p-6 space-y-4">
      <SectionHeading title={s.credential_vault} />
      <div className="flex items-start gap-2 text-sm text-muted-foreground/70">
        <ShieldCheck className="w-4 h-4 mt-0.5 flex-shrink-0 text-amber-400/70" />
        <p>
          {s.credential_vault_hint}
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        {/* Export credentials */}
        <div className="space-y-2">
          {!showCredExportInput ? (
            <button
              onClick={() => setShowCredExportInput(true)}
              disabled={credExportStatus === 'loading'}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-modal text-sm font-medium
                bg-amber-500/10 text-amber-400 border border-amber-500/20 hover:bg-amber-500/15
                transition-colors disabled:opacity-50"
            >
              {credExportStatus === 'success' ? <Check className="w-4 h-4" /> : <KeyRound className="w-4 h-4" />}
              {credExportStatus === 'success' ? s.exported : s.export_credentials}
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <input
                type="password"
                placeholder="Passphrase (min 8 chars)"
                value={credExportPassphrase}
                onChange={(e) => setCredExportPassphrase(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && onCredExport()}
                className="px-3 py-2 rounded-card border border-primary/15 bg-secondary/20 text-sm text-foreground/90 placeholder:text-muted-foreground/40 outline-none focus-visible:border-amber-500/30 w-56"
                autoFocus
              />
              <button onClick={onCredExport} disabled={credExportStatus === 'loading'}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-card text-sm font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20 hover:bg-amber-500/15 transition-colors disabled:opacity-50">
                {credExportStatus === 'loading' ? <LoadingSpinner /> : <Download className="w-4 h-4" />}
                Export
              </button>
              <button onClick={() => { setShowCredExportInput(false); setCredExportPassphrase(''); }}
                className="text-xs text-muted-foreground/50 hover:text-muted-foreground/80 transition-colors">
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
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-modal text-sm font-medium
                bg-blue-500/10 text-blue-400 border border-blue-500/20 hover:bg-blue-500/15
                transition-colors disabled:opacity-50"
            >
              {credImportStatus === 'success' ? <Check className="w-4 h-4" /> : <Upload className="w-4 h-4" />}
              {credImportStatus === 'success' ? s.imported : s.import_credentials}
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <input
                type="password" placeholder="Passphrase" value={credImportPassphrase}
                onChange={(e) => setCredImportPassphrase(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && onCredImport()}
                className="px-3 py-2 rounded-card border border-primary/15 bg-secondary/20 text-sm text-foreground/90 placeholder:text-muted-foreground/40 outline-none focus-visible:border-blue-500/30 w-56"
                autoFocus
              />
              <button onClick={onCredImport} disabled={credImportStatus === 'loading'}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-card text-sm font-medium bg-blue-500/10 text-blue-400 border border-blue-500/20 hover:bg-blue-500/15 transition-colors disabled:opacity-50">
                {credImportStatus === 'loading' ? <LoadingSpinner /> : <Upload className="w-4 h-4" />}
                Import
              </button>
              <button onClick={() => { setShowCredImportInput(false); setCredImportPassphrase(''); }}
                className="text-xs text-muted-foreground/50 hover:text-muted-foreground/80 transition-colors">
                Cancel
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Conflict resolution UI */}
      {hasConflicts && (
        <div className="rounded-card border border-amber-500/20 bg-amber-500/5 p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium text-amber-400">
            <AlertTriangle className="w-4 h-4" />
            {conflicts.length} credential{conflicts.length > 1 ? 's' : ''} already exist
          </div>
          <p className="text-xs text-muted-foreground/70">
            Choose how to handle each conflict:
          </p>
          <div className="space-y-2">
            {conflicts.map((c) => (
              <div key={c.name} className="flex items-center gap-3 px-3 py-2 rounded-card bg-secondary/20 border border-primary/10">
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium text-foreground/80 truncate block">{c.name}</span>
                  <span className="text-xs text-muted-foreground/50">{c.service_type}</span>
                </div>
                <div className="flex items-center gap-1">
                  {(['skip', 'keep_both', 'replace'] as const).map((action) => {
                    const isActive = resolutions[c.name] === action;
                    const labels: Record<ConflictAction, string> = { skip: 'Skip', keep_both: 'Keep Both', replace: 'Replace' };
                    const colors: Record<ConflictAction, string> = {
                      skip: isActive ? 'bg-muted-foreground/20 text-foreground/80 border-muted-foreground/30' : 'text-muted-foreground/50',
                      keep_both: isActive ? 'bg-blue-500/15 text-blue-400 border-blue-500/25' : 'text-muted-foreground/50',
                      replace: isActive ? 'bg-amber-500/15 text-amber-400 border-amber-500/25' : 'text-muted-foreground/50',
                    };
                    return (
                      <button
                        key={action}
                        onClick={() => setResolution(c.name, action)}
                        className={`px-2.5 py-1 rounded-input text-xs font-medium border transition-colors ${
                          isActive ? colors[action] : `${colors[action]} border-transparent hover:border-primary/15`
                        }`}
                      >
                        {labels[action]}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
          <button
            onClick={handleApplyResolutions}
            disabled={!allResolved}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-modal text-sm font-medium bg-blue-500/10 text-blue-400 border border-blue-500/20 hover:bg-blue-500/15 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Upload className="w-4 h-4" />
            {s.import_with_resolutions}
          </button>
        </div>
      )}

      {/* Import result (no conflicts) */}
      {credImportResult && !hasConflicts && credImportResult.created > 0 && (
        <div className="rounded-card border border-emerald-500/20 bg-emerald-500/5 p-4 space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium text-emerald-400">
            <PackageCheck className="w-4 h-4" />
            {s.cred_import_complete}
          </div>
          <p className="text-sm text-muted-foreground/80">
            {credImportResult.created} imported
            {credImportResult.skipped > 0 && `, ${credImportResult.skipped} skipped`}
            {credImportResult.replaced > 0 && `, ${credImportResult.replaced} replaced`}
          </p>
          {credImportResult.warnings.length > 0 && (
            <div className="mt-2 space-y-1">
              <p className="text-sm font-medium text-amber-400">Warnings:</p>
              {credImportResult.warnings.map((w, i) => (
                <p key={i} className="text-sm text-muted-foreground/70 pl-2">- {w}</p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
