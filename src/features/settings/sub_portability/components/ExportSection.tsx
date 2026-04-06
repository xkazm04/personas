import { useState } from 'react';
import {
  Upload,
  Download,
  PackageCheck,
  Check,
  KeyRound,
} from 'lucide-react';
import { SectionHeading } from '@/features/shared/components/layout/SectionHeading';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { ExportSelectionModal } from './ExportSelectionModal';
import type { PortabilityImportResult } from '@/api/system/dataPortability';

type Status = 'idle' | 'loading' | 'success' | 'error';

interface ExportSectionProps {
  exportStatus: Status;
  importStatus: Status;
  importResult: PortabilityImportResult | null;
  showExportModal: boolean;
  onOpenExportModal: () => void;
  onCloseExportModal: () => void;
  onExportSelective: (personaIds: string[], teamIds: string[], credentialIds: string[], passphrase?: string) => void;
  onImport: (passphrase?: string) => void;
}

export function ExportSection({
  exportStatus,
  importStatus,
  importResult,
  showExportModal,
  onOpenExportModal,
  onCloseExportModal,
  onExportSelective,
  onImport,
}: ExportSectionProps) {
  const [importPassphrase, setImportPassphrase] = useState('');

  const handleImport = () => {
    onImport(importPassphrase || undefined);
  };

  return (
    <div className="rounded-xl border border-primary/10 bg-card-bg p-6 space-y-4">
      <SectionHeading title="Workspace Export & Import" />
      <p className="text-sm text-muted-foreground/70">
        Export your workspace to a portable ZIP archive containing personas, teams,
        credentials, and related data. Choose exactly what to include. Import restores
        from a previously exported archive — imported items are created as new entities
        (disabled by default).
      </p>

      <div className="flex flex-wrap gap-3">
        <button
          onClick={onOpenExportModal}
          disabled={exportStatus === 'loading'}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium
            bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/15
            transition-colors disabled:opacity-50"
        >
          {exportStatus === 'loading' ? (
            <LoadingSpinner />
          ) : exportStatus === 'success' ? (
            <Check className="w-4 h-4" />
          ) : (
            <Download className="w-4 h-4" />
          )}
          {exportStatus === 'loading'
            ? 'Exporting...'
            : exportStatus === 'success'
              ? 'Exported!'
              : 'Export Workspace'}
        </button>

        <button
          onClick={handleImport}
          disabled={importStatus === 'loading'}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium
            bg-blue-500/10 text-blue-400 border border-blue-500/20 hover:bg-blue-500/15
            transition-colors disabled:opacity-50"
        >
          {importStatus === 'loading' ? (
            <LoadingSpinner />
          ) : importStatus === 'success' ? (
            <Check className="w-4 h-4" />
          ) : (
            <Upload className="w-4 h-4" />
          )}
          {importStatus === 'loading'
            ? 'Importing...'
            : importStatus === 'success'
              ? 'Imported!'
              : 'Import Workspace'}
        </button>
      </div>

      {/* Import passphrase input */}
      <div className="space-y-1.5">
        <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground/60">
          <KeyRound className="w-3.5 h-3.5" />
          Decrypt credentials on import (if encrypted)
        </label>
        <input
          type="password"
          placeholder="Enter passphrase to decrypt credentials"
          value={importPassphrase}
          onChange={(e) => setImportPassphrase(e.target.value)}
          className="px-3 py-2 rounded-lg border border-primary/10 bg-secondary/20 text-sm
            text-foreground/90 placeholder:text-muted-foreground/40 outline-none
            focus-visible:border-blue-500/30 w-full max-w-sm"
        />
        <p className="text-xs text-muted-foreground/50">
          Leave empty if the export does not contain encrypted credentials.
        </p>
      </div>

      {/* Import result */}
      {importResult && (
        <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-4 space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium text-emerald-400">
            <PackageCheck className="w-4 h-4" />
            Import Complete
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 2xl:grid-cols-4 3xl:grid-cols-6 gap-2 text-sm text-muted-foreground/80">
            {importResult.personas_created > 0 && (
              <span>{importResult.personas_created} persona(s)</span>
            )}
            {importResult.teams_created > 0 && (
              <span>{importResult.teams_created} team(s)</span>
            )}
            {importResult.tools_created > 0 && (
              <span>{importResult.tools_created} tool(s)</span>
            )}
            {importResult.groups_created > 0 && (
              <span>{importResult.groups_created} group(s)</span>
            )}
            {importResult.credentials_created > 0 && (
              <span>{importResult.credentials_created} credential(s)</span>
            )}
          </div>
          {importResult.warnings.length > 0 && (
            <div className="mt-2 space-y-1">
              <p className="text-sm font-medium text-amber-400">Warnings:</p>
              {importResult.warnings.map((w, i) => (
                <p key={i} className="text-sm text-muted-foreground/70 pl-2">
                  - {w}
                </p>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Export selection modal */}
      <ExportSelectionModal
        isOpen={showExportModal}
        onClose={onCloseExportModal}
        onExport={onExportSelective}
        exporting={exportStatus === 'loading'}
      />
    </div>
  );
}
