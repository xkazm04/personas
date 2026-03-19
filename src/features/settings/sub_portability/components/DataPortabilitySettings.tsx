import { HardDriveDownload, AlertTriangle } from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { useDataPortability } from '../libs/useDataPortability';
import { ExportSection } from './ExportSection';
import { CredentialPortability } from './CredentialPortability';

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-primary/10 bg-secondary/10 p-3 text-center">
      <div className="text-lg font-semibold text-foreground/90">{value}</div>
      <div className="text-xs text-muted-foreground/70">{label}</div>
    </div>
  );
}

export default function DataPortabilitySettings() {
  const dp = useDataPortability();

  return (
    <ContentBox>
      <ContentHeader
        icon={<HardDriveDownload className="w-5 h-5 text-emerald-400" />}
        iconColor="emerald"
        title="Data Portability"
        subtitle="Export, import, and migrate your workspace data"
      />

      <ContentBody centered>
        <div className="space-y-6">
          {/* Workspace overview */}
          <div className="rounded-xl border border-primary/10 bg-card-bg p-6 space-y-4">
            <h2 className="text-sm font-mono text-muted-foreground/90 uppercase tracking-wider">
              Workspace Overview
            </h2>

            {dp.statsStatus === 'loading' && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground/70">
                <LoadingSpinner />
                Loading workspace stats...
              </div>
            )}

            {dp.statsStatus === 'error' && (
              <p className="text-sm text-red-400">Failed to load workspace statistics.</p>
            )}

            {dp.stats && (
              <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))' }}>
                <StatCard label="Personas" value={dp.stats.persona_count} />
                <StatCard label="Teams" value={dp.stats.team_count} />
                <StatCard label="Tools" value={dp.stats.tool_count} />
                <StatCard label="Groups" value={dp.stats.group_count} />
                <StatCard label="Connectors" value={dp.stats.connector_count} />
                <StatCard label="Memories" value={dp.stats.memory_count} />
                <StatCard label="Test Suites" value={dp.stats.test_suite_count} />
              </div>
            )}
          </div>

          <ExportSection
            exportStatus={dp.exportStatus}
            importStatus={dp.importStatus}
            importResult={dp.importResult}
            onExport={dp.handleExportFull}
            onImport={dp.handleImport}
          />

          <CredentialPortability
            credExportStatus={dp.credExportStatus}
            credImportStatus={dp.credImportStatus}
            credImportResult={dp.credImportResult}
            credExportPassphrase={dp.credExportPassphrase}
            setCredExportPassphrase={dp.setCredExportPassphrase}
            credImportPassphrase={dp.credImportPassphrase}
            setCredImportPassphrase={dp.setCredImportPassphrase}
            showCredExportInput={dp.showCredExportInput}
            setShowCredExportInput={dp.setShowCredExportInput}
            showCredImportInput={dp.showCredImportInput}
            setShowCredImportInput={dp.setShowCredImportInput}
            onCredExport={dp.handleCredExport}
            onCredImport={dp.handleCredImport}
          />

          {/* Error display */}
          {dp.errorMsg && (
            <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-4 flex items-start gap-3">
              <AlertTriangle className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0" />
              <div className="text-sm text-muted-foreground/80">
                <p className="font-medium text-red-400/90 mb-1">Error</p>
                <p>{dp.errorMsg}</p>
              </div>
            </div>
          )}
        </div>
      </ContentBody>
    </ContentBox>
  );
}
