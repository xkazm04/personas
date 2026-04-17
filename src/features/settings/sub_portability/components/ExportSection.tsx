import { useState } from 'react';
import {
  Upload,
  Download,
  PackageCheck,
  Check,
} from 'lucide-react';
import { SectionHeading } from '@/features/shared/components/layout/SectionHeading';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { ExportSelectionModal } from './ExportSelectionModal';
import type { PortabilityImportResult } from '@/api/system/dataPortability';
import { useTranslation } from '@/i18n/useTranslation';

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
  const [showImportInput, setShowImportInput] = useState(false);
  const { t } = useTranslation();
  const s = t.settings.portability;

  const handleImport = () => {
    onImport(importPassphrase || undefined);
    setImportPassphrase('');
    setShowImportInput(false);
  };

  return (
    <div className="rounded-modal border border-primary/10 bg-card-bg p-6 space-y-4">
      <SectionHeading title={s.export_import_title} />
      <p className="text-sm text-foreground">
        {s.export_import_hint}
      </p>

      <div className="flex flex-wrap gap-3">
        <button
          onClick={onOpenExportModal}
          disabled={exportStatus === 'loading'}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-modal text-sm font-medium
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
            ? s.exporting
            : exportStatus === 'success'
              ? s.exported
              : s.export_workspace}
        </button>

        {!showImportInput ? (
          <button
            onClick={() => setShowImportInput(true)}
            disabled={importStatus === 'loading'}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-modal text-sm font-medium
              bg-blue-500/10 text-blue-400 border border-blue-500/20 hover:bg-blue-500/15
              transition-colors disabled:opacity-50"
          >
            {importStatus === 'success' ? <Check className="w-4 h-4" /> : <Upload className="w-4 h-4" />}
            {importStatus === 'success' ? s.imported : s.import_workspace}
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <input
              type="password"
              placeholder={s.passphrase_optional}
              value={importPassphrase}
              onChange={(e) => setImportPassphrase(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleImport()}
              className="px-3 py-2 rounded-card border border-primary/15 bg-secondary/20 text-sm
                text-foreground/90 placeholder:text-foreground outline-none
                focus-visible:border-blue-500/30 w-56"
              autoFocus
            />
            <button
              onClick={handleImport}
              disabled={importStatus === 'loading'}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-card text-sm font-medium
                bg-blue-500/10 text-blue-400 border border-blue-500/20 hover:bg-blue-500/15
                transition-colors disabled:opacity-50"
            >
              {importStatus === 'loading' ? <LoadingSpinner /> : <Upload className="w-4 h-4" />}
              {s.import_label}
            </button>
            <button
              onClick={() => { setShowImportInput(false); setImportPassphrase(''); }}
              className="text-xs text-foreground hover:text-muted-foreground/80 transition-colors"
            >
              {s.cancel}
            </button>
          </div>
        )}
      </div>

      {/* Import result */}
      {importResult && (
        <div className="rounded-card border border-emerald-500/20 bg-emerald-500/5 p-4 space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium text-emerald-400">
            <PackageCheck className="w-4 h-4" />
            {s.import_complete}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 2xl:grid-cols-4 3xl:grid-cols-6 gap-2 text-sm text-foreground">
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
              <p className="text-sm font-medium text-amber-400">{s.warnings}</p>
              {importResult.warnings.map((w, i) => (
                <p key={i} className="text-sm text-foreground pl-2">
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
