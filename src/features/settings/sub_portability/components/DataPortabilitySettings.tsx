import { HardDriveDownload, AlertTriangle } from 'lucide-react';
import { SectionHeading } from '@/features/shared/components/layout/SectionHeading';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { useDataPortability } from '../libs/useDataPortability';
import { ExportSection } from './ExportSection';
import { CredentialPortability } from './CredentialPortability';
import { useTranslation } from '@/i18n/useTranslation';

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-card border border-primary/10 bg-secondary/10 p-3 text-center">
      <div className="typo-heading-lg font-semibold text-foreground/90">{value}</div>
      <div className="typo-caption text-foreground">{label}</div>
    </div>
  );
}

export default function DataPortabilitySettings() {
  const dp = useDataPortability();
  const { t } = useTranslation();
  const s = t.settings.portability;

  return (
    <ContentBox>
      <ContentHeader
        icon={<HardDriveDownload className="w-5 h-5 text-emerald-400" />}
        iconColor="emerald"
        title={s.title}
        subtitle={s.subtitle}
      />

      <ContentBody centered>
        <div className="space-y-6">
          {/* Workspace overview */}
          <div className="rounded-modal border border-primary/10 bg-card-bg p-6 space-y-4">
            <SectionHeading title={s.workspace_overview} />

            {dp.statsStatus === 'loading' && (
              <div className="flex items-center gap-2 typo-body text-foreground">
                <LoadingSpinner />
                {s.loading_stats}
              </div>
            )}

            {dp.statsStatus === 'error' && (
              <p className="typo-body text-red-400">{s.stats_error}</p>
            )}

            {dp.stats && (
              <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))' }}>
                <StatCard label={s.personas} value={dp.stats.persona_count} />
                <StatCard label={s.teams} value={dp.stats.team_count} />
                <StatCard label={s.tools} value={dp.stats.tool_count} />
                <StatCard label={s.groups} value={dp.stats.group_count} />
                <StatCard label={s.credentials} value={dp.stats.credential_count} />
                <StatCard label={s.memories} value={dp.stats.memory_count} />
                <StatCard label={s.test_suites} value={dp.stats.test_suite_count} />
              </div>
            )}
          </div>

          <ExportSection
            exportStatus={dp.exportStatus}
            importStatus={dp.importStatus}
            importResult={dp.importResult}
            showExportModal={dp.showExportModal}
            onOpenExportModal={() => dp.setShowExportModal(true)}
            onCloseExportModal={() => dp.setShowExportModal(false)}
            onExportSelective={dp.handleExportSelective}
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
            onCredImportWithResolutions={dp.handleCredImportWithResolutions}
          />

          {/* Error display */}
          {dp.errorMsg && (
            <div className="rounded-modal border border-red-500/20 bg-red-500/5 p-4 flex items-start gap-3">
              <AlertTriangle className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0" />
              <div className="typo-body text-foreground">
                <p className="font-medium text-red-400/90 mb-1">{s.error_label}</p>
                <p>{dp.errorMsg}</p>
              </div>
            </div>
          )}
        </div>
      </ContentBody>
    </ContentBox>
  );
}
