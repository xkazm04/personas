import { useState } from 'react';
import {
  Upload,
  Download,
  PackageCheck,
  Check,
} from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { PasswordToggleField } from '@/features/shared/components/forms/PasswordToggleField';
import { ExportSelectionModal } from './ExportSelectionModal';
import { ImportConflictPanel } from './ImportConflictPanel';
import type { PortabilityImportResult, ExportSelectionArgs } from '@/api/system/dataPortability';
import { useTranslation } from '@/i18n/useTranslation';

type Status = 'idle' | 'loading' | 'success' | 'error';

interface ExportSectionProps {
  exportStatus: Status;
  importStatus: Status;
  importResult: PortabilityImportResult | null;
  showExportModal: boolean;
  onOpenExportModal: () => void;
  onCloseExportModal: () => void;
  onExportSelective: (args: ExportSelectionArgs) => void;
  onImport: (passphrase?: string) => void;
  onImportWithResolutions: (resolutions: Record<string, string>) => void;
  onDismissConflicts: () => void;
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
  onImportWithResolutions,
  onDismissConflicts,
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
    <div className="space-y-4">
      <p className="typo-body text-foreground">
        {s.export_import_hint}
      </p>

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={onOpenExportModal}
          disabled={exportStatus === 'loading'}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-modal typo-body font-medium
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
            type="button"
            onClick={() => setShowImportInput(true)}
            disabled={importStatus === 'loading'}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-modal typo-body font-medium
              bg-blue-500/10 text-blue-400 border border-blue-500/20 hover:bg-blue-500/15
              transition-colors disabled:opacity-50"
          >
            {importStatus === 'success' ? <Check className="w-4 h-4" /> : <Upload className="w-4 h-4" />}
            {importStatus === 'success' ? s.imported : s.import_workspace}
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <PasswordToggleField
              placeholder={s.passphrase_optional}
              value={importPassphrase}
              onChange={(e) => setImportPassphrase(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleImport()}
              inputClassName="w-56 px-3 py-2 rounded-card border border-primary/15 bg-secondary/20 typo-body text-foreground/90 placeholder:text-foreground/45 outline-none focus-visible:border-blue-500/30"
              autoFocus
            />
            <button
              type="button"
              onClick={handleImport}
              disabled={importStatus === 'loading'}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-card typo-body font-medium
                bg-blue-500/10 text-blue-400 border border-blue-500/20 hover:bg-blue-500/15
                transition-colors disabled:opacity-50"
            >
              {importStatus === 'loading' ? <LoadingSpinner /> : <Upload className="w-4 h-4" />}
              {s.import_label}
            </button>
            <button
              type="button"
              onClick={() => { setShowImportInput(false); setImportPassphrase(''); }}
              className="typo-caption text-foreground hover:text-muted-foreground/80 transition-colors"
            >
              {s.cancel}
            </button>
          </div>
        )}
      </div>

      {/* Conflict resolution (pass 2) — dev projects and twins */}
      {importResult && importResult.importConflicts.length > 0 && (
        <ImportConflictPanel
          conflicts={importResult.importConflicts}
          busy={importStatus === 'loading'}
          onConfirm={onImportWithResolutions}
          onDismiss={onDismissConflicts}
        />
      )}

      {/* Import result */}
      {importResult && (
        <div className="rounded-card border border-emerald-500/20 bg-emerald-500/5 p-4 space-y-2">
          <div className="flex items-center gap-2 typo-body font-medium text-emerald-400">
            <PackageCheck className="w-4 h-4" />
            {s.import_complete}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 2xl:grid-cols-4 3xl:grid-cols-6 gap-2 typo-body text-foreground">
            {importResult.personasCreated > 0 && (
              <span>{s.import_personas.replace('{count}', String(importResult.personasCreated))}</span>
            )}
            {importResult.teamsCreated > 0 && (
              <span>{s.import_teams.replace('{count}', String(importResult.teamsCreated))}</span>
            )}
            {importResult.toolsCreated > 0 && (
              <span>{s.import_tools.replace('{count}', String(importResult.toolsCreated))}</span>
            )}
            {importResult.credentialsCreated > 0 && (
              <span>{s.import_credentials_count.replace('{count}', String(importResult.credentialsCreated))}</span>
            )}
            {importResult.teamMemoriesCreated > 0 && (
              <span>{s.import_team_memories.replace('{count}', String(importResult.teamMemoriesCreated))}</span>
            )}
            {importResult.kpisCreated > 0 && (
              <span>{s.import_kpis.replace('{count}', String(importResult.kpisCreated))}</span>
            )}
            {importResult.projectsImported > 0 && (
              <span>{s.import_projects.replace('{count}', String(importResult.projectsImported))}</span>
            )}
            {importResult.projectsSkipped > 0 && (
              <span>{s.import_projects_skipped.replace('{count}', String(importResult.projectsSkipped))}</span>
            )}
            {importResult.knowledgeImported > 0 && (
              <span>{s.import_knowledge.replace('{count}', String(importResult.knowledgeImported))}</span>
            )}
            {importResult.knowledgeSkippedDuplicates > 0 && (
              <span>{s.import_knowledge_skipped.replace('{count}', String(importResult.knowledgeSkippedDuplicates))}</span>
            )}
            {importResult.skillsWritten > 0 && (
              <span>{s.import_skills_written.replace('{count}', String(importResult.skillsWritten))}</span>
            )}
            {importResult.skillsDeferred > 0 && (
              <span>{s.import_skills_deferred.replace('{count}', String(importResult.skillsDeferred))}</span>
            )}
            {importResult.twinsImported > 0 && (
              <span>{s.import_twins.replace('{count}', String(importResult.twinsImported))}</span>
            )}
            {importResult.twinsSkipped > 0 && (
              <span>{s.import_twins_skipped.replace('{count}', String(importResult.twinsSkipped))}</span>
            )}
            {importResult.twinKbChunksImported > 0 && (
              <span>{s.import_twin_kb_chunks.replace('{count}', String(importResult.twinKbChunksImported))}</span>
            )}
            {importResult.athenaMemoryImported > 0 && (
              <span>{s.import_athena_memory.replace('{count}', String(importResult.athenaMemoryImported))}</span>
            )}
            {importResult.athenaIdentityReplaced && <span>{s.import_athena_identity_replaced}</span>}
            {importResult.reembedQueued > 0 && (
              <span>{s.import_reembed_queued.replace('{count}', String(importResult.reembedQueued))}</span>
            )}
          </div>
          {importResult.warnings.length > 0 && (
            <div className="mt-2 space-y-1">
              <p className="typo-body font-medium text-amber-400">{s.warnings}</p>
              {importResult.warnings.map((w, i) => (
                <p key={i} className="typo-body text-foreground pl-2">
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
