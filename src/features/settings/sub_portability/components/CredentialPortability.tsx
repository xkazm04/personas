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
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { PasswordToggleField } from '@/features/shared/components/forms/PasswordToggleField';
import { Button } from '@/features/shared/components/buttons';
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
  /** Abandon the conflict pass: without it the panel can never close. */
  onCredDismissConflicts?: () => void;
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
  onCredDismissConflicts,
}: CredentialPortabilityProps) {
  const [resolutions, setResolutions] = useState<Record<string, ConflictAction>>({});
  const { t, tx } = useTranslation();
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

  const handleDismissConflicts = () => {
    setResolutions({});
    onCredDismissConflicts?.();
  };

  // A receipt for every finished pass, not only one that created something: a
  // resolution pass that skipped every conflict created 0 and showed nothing.
  const hasReceipt = credImportResult != null && !hasConflicts && (
    credImportResult.created + credImportResult.skipped + credImportResult.replaced > 0
    || credImportResult.warnings.length > 0
  );

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2 typo-body text-foreground">
        <ShieldCheck className="w-4 h-4 mt-0.5 flex-shrink-0 text-status-warning/70" />
        <p>
          {s.credential_vault_hint}
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        {/* Export credentials */}
        <div className="space-y-2">
          {!showCredExportInput ? (
            <Button
              type="button"
              onClick={() => setShowCredExportInput(true)}
              disabled={credExportStatus === 'loading'}
              variant="accent"
              tone="warning"
              size="md"
              icon={credExportStatus === 'success' ? <Check className="w-4 h-4" /> : <KeyRound className="w-4 h-4" />}
            >
              {credExportStatus === 'success' ? s.exported : s.export_credentials}
            </Button>
          ) : (
            <div className="flex items-center gap-2">
              <PasswordToggleField
                placeholder={s.passphrase_min}
                value={credExportPassphrase}
                onChange={(e) => setCredExportPassphrase(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && onCredExport()}
                inputClassName="w-56 px-3 py-2 rounded-card border border-hair bg-surface-1 typo-body text-ink-1 placeholder:text-ink-3 outline-none focus-visible:border-status-warning/30"
                autoFocus
              />
              <Button
                type="button"
                onClick={onCredExport}
                disabled={credExportStatus === 'loading'}
                variant="accent"
                tone="warning"
                size="md"
                icon={credExportStatus === 'loading' ? <LoadingSpinner /> : <Download className="w-4 h-4" />}
              >
                {s.export}
              </Button>
              <Button
                type="button"
                onClick={() => { setShowCredExportInput(false); setCredExportPassphrase(''); }}
                variant="ghost"
                size="sm"
              >
                {s.cancel}
              </Button>
            </div>
          )}
        </div>

        {/* Import credentials */}
        <div className="space-y-2">
          {!showCredImportInput ? (
            <Button
              type="button"
              onClick={() => setShowCredImportInput(true)}
              disabled={credImportStatus === 'loading'}
              variant="accent"
              tone="info"
              size="md"
              icon={credImportStatus === 'success' ? <Check className="w-4 h-4" /> : <Upload className="w-4 h-4" />}
            >
              {credImportStatus === 'success' ? s.imported : s.import_credentials}
            </Button>
          ) : (
            <div className="flex items-center gap-2">
              <PasswordToggleField
                placeholder={s.passphrase_label}
                value={credImportPassphrase}
                onChange={(e) => setCredImportPassphrase(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && onCredImport()}
                inputClassName="w-56 px-3 py-2 rounded-card border border-hair bg-surface-1 typo-body text-ink-1 placeholder:text-ink-3 outline-none focus-visible:border-status-info/30"
                autoFocus
              />
              <Button
                type="button"
                onClick={onCredImport}
                disabled={credImportStatus === 'loading'}
                variant="accent"
                tone="info"
                size="md"
                icon={credImportStatus === 'loading' ? <LoadingSpinner /> : <Upload className="w-4 h-4" />}
              >
                {s.import_label}
              </Button>
              <Button
                type="button"
                onClick={() => { setShowCredImportInput(false); setCredImportPassphrase(''); }}
                variant="ghost"
                size="sm"
              >
                {s.cancel}
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Conflict resolution UI */}
      {hasConflicts && (
        <div className="rounded-card border border-status-warning/20 bg-status-warning/5 p-4 space-y-3">
          <div className="flex items-center gap-2 typo-body text-status-warning">
            <AlertTriangle className="w-4 h-4" />
            {conflicts.length > 1 ? s.credentials_exist_plural.replace('{count}', String(conflicts.length)) : s.credentials_exist.replace('{count}', String(conflicts.length))}
          </div>
          <p className="typo-caption text-foreground">
            {s.conflict_hint}
          </p>
          <div className="space-y-2">
            {conflicts.map((c) => (
              <div key={c.name} className="flex items-center gap-3 px-3 py-2 rounded-card bg-surface-1 border border-hair">
                <div className="flex-1 min-w-0">
                  <span className="typo-body text-foreground truncate block">{c.name}</span>
                  <span className="typo-caption text-foreground">{c.serviceType}</span>
                </div>
                <div className="flex items-center gap-1">
                  {(['skip', 'keep_both', 'replace'] as const).map((action) => {
                    const isActive = resolutions[c.name] === action;
                    const labels: Record<ConflictAction, string> = { skip: s.skip, keep_both: s.keep_both, replace: s.replace };
                    return (
                      <Button
                        key={action}
                        type="button"
                        onClick={() => setResolution(c.name, action)}
                        variant={isActive ? 'accent' : 'ghost'}
                        tone={isActive ? (action === 'keep_both' ? 'info' : action === 'replace' ? 'warning' : 'highlight') : undefined}
                        size="xs"
                      >
                        {labels[action]}
                      </Button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            onClick={handleApplyResolutions}
            disabled={!allResolved}
            variant="accent"
            tone="info"
            size="md"
            icon={<Upload className="w-4 h-4" />}
          >
            {s.import_with_resolutions}
          </Button>
          {onCredDismissConflicts && (
            <Button
              variant="ghost"
              size="sm"
              data-testid="portability-cred-conflict-cancel"
              onClick={handleDismissConflicts}
              disabled={credImportStatus === 'loading'}
            >
              {s.cancel}
            </Button>
          )}
          </div>
        </div>
      )}

      {/* Import result (no conflicts) */}
      {credImportResult && hasReceipt && (
        <div className="rounded-card border border-hair bg-surface-1 p-4 space-y-2">
          <div className="flex items-center gap-2 typo-body text-status-success">
            <PackageCheck className="w-4 h-4" />
            {s.cred_import_complete}
          </div>
          <p className="typo-body text-foreground">
            {tx(s.cred_imported, { count: credImportResult.created })}
            {credImportResult.skipped > 0 && tx(s.cred_skipped, { count: credImportResult.skipped })}
            {credImportResult.replaced > 0 && tx(s.cred_replaced, { count: credImportResult.replaced })}
          </p>
          {credImportResult.warnings.length > 0 && (
            <div className="mt-2 space-y-1">
              <p className="typo-body text-status-warning">{s.warnings}</p>
              {credImportResult.warnings.map((w, i) => (
                <p key={i} className="typo-body text-foreground pl-2">- {w}</p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
