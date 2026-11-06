import { HardDriveDownload, AlertTriangle, Boxes, Download, ShieldCheck, HardDrive, Bot, Users, Wrench, KeyRound, Brain, BrainCircuit, FlaskConical, Target, FolderGit2, Fingerprint, Sparkles, Library, type LucideIcon } from 'lucide-react';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { SettingsScaffold, type SettingsSection } from '@/features/shared/components/layout/settings/SettingsScaffold';
import { useDataPortability } from '../libs/useDataPortability';
import { ExportSection } from './ExportSection';
import { CredentialPortability } from './CredentialPortability';
import { StorageUsageSection } from './StorageUsageSection';
import { useTranslation } from '@/i18n/useTranslation';

/** Compact stat badge: an accent lucide glyph stands in for the label word
 *  (kept as a hover tooltip + screen-reader text), paired with the count. */
function StatBadge({ icon: Icon, label, value, accent }: { icon: LucideIcon; label: string; value: number; accent: string }) {
  return (
    <Tooltip content={label} placement="top">
      <div className="flex items-center justify-center gap-1.5 rounded-card border border-hair bg-secondary/10 px-2 py-1.5">
        <Icon className={`w-4 h-4 flex-shrink-0 ${accent}`} aria-hidden />
        <span className="typo-heading text-foreground tabular-nums">{value}</span>
        <span className="sr-only">{label}</span>
      </div>
    </Tooltip>
  );
}

export default function DataPortabilitySettings() {
  const dp = useDataPortability();
  const { t } = useTranslation();
  const s = t.settings.portability;

  const sections: SettingsSection[] = [
    {
      id: 'workspace',
      label: s.workspace_overview,
      icon: <Boxes className="w-4 h-4 text-ink-2" />,
      content: (
        <div className="space-y-4">
          {dp.statsStatus === 'loading' && (
            <div className="flex items-center gap-2 typo-body text-foreground">
              <LoadingSpinner />
              {s.loading_stats}
            </div>
          )}

          {dp.statsStatus === 'error' && (
            <p className="typo-body text-status-error">{s.stats_error}</p>
          )}

          {dp.stats && (
            <div className="flex flex-wrap gap-2">
              <StatBadge icon={Bot} label={s.personas} value={dp.stats.personaCount} accent="text-status-success" />
              <StatBadge icon={Users} label={s.teams} value={dp.stats.teamCount} accent="text-status-info" />
              <StatBadge icon={Wrench} label={s.tools} value={dp.stats.toolCount} accent="text-status-warning" />
              <StatBadge icon={KeyRound} label={s.credentials} value={dp.stats.credentialCount} accent="text-role-agent" />
              <StatBadge icon={Brain} label={s.memories} value={dp.stats.memoryCount} accent="text-role-highlight" />
              <StatBadge icon={BrainCircuit} label={s.team_memories} value={dp.stats.teamMemoryCount} accent="text-teal-400" />
              <StatBadge icon={FlaskConical} label={s.test_suites} value={dp.stats.testSuiteCount} accent="text-status-error" />
              <StatBadge icon={Target} label={s.kpis} value={dp.stats.kpiCount} accent="text-role-human" />
              <StatBadge icon={FolderGit2} label={s.dev_projects} value={dp.stats.devProjectCount} accent="text-status-success" />
              <StatBadge icon={Fingerprint} label={s.twins} value={dp.stats.twinCount} accent="text-status-error" />
              <StatBadge icon={Sparkles} label={s.athena_core} value={dp.stats.athenaCoreCount} accent="text-fuchsia-400" />
              <StatBadge icon={Library} label={s.athena_learned} value={dp.stats.athenaLearnedCount} accent="text-fuchsia-300" />
            </div>
          )}

          {/* Export-side truncation warnings (e.g. a capped history window) —
              surfaced next to the counts they qualify. */}
          {dp.stats && dp.stats.warnings.length > 0 && (
            <div data-testid="portability-export-warnings" className="space-y-1">
              <p className="typo-body text-status-warning">{s.warnings}</p>
              {dp.stats.warnings.map((w, i) => (
                <p key={i} className="typo-body text-foreground pl-2">
                  - {w}
                </p>
              ))}
            </div>
          )}
        </div>
      ),
    },
    {
      id: 'export',
      label: s.export_import_title,
      icon: <Download className="w-4 h-4 text-ink-2" />,
      content: (
        <ExportSection
          exportStatus={dp.exportStatus}
          importStatus={dp.importStatus}
          importResult={dp.importResult}
          showExportModal={dp.showExportModal}
          onOpenExportModal={() => dp.setShowExportModal(true)}
          onCloseExportModal={() => dp.setShowExportModal(false)}
          onExportSelective={dp.handleExportSelective}
          onImport={dp.handleImport}
          onImportWithResolutions={dp.handleImportWithResolutions}
          onDismissConflicts={dp.dismissImportConflicts}
        />
      ),
    },
    {
      id: 'credentials',
      label: s.credential_vault,
      icon: <ShieldCheck className="w-4 h-4 text-ink-2" />,
      content: (
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
          onCredDismissConflicts={dp.dismissCredImportConflicts}
        />
      ),
    },
    {
      id: 'storage',
      label: s.storage_title,
      subtitle: s.storage_subtitle,
      icon: <HardDrive className="w-4 h-4 text-ink-2" />,
      content: <StorageUsageSection />,
    },
  ];

  return (
    <ContentBox>
      <ContentHeader
        icon={<HardDriveDownload className="w-5 h-5 text-ink-2" />}
        iconColor="emerald"
        title={s.title}
        subtitle={s.subtitle}
      />

      <ContentBody centered>
        <div className="max-w-5xl mx-auto space-y-4">
          <SettingsScaffold sections={sections} navAriaLabel={s.title} />

          {/* Error display */}
          {dp.errorMsg && (
            <div className="rounded-modal border border-status-error/20 bg-status-error/5 p-4 flex items-start gap-3">
              <AlertTriangle className="w-4 h-4 text-status-error mt-0.5 flex-shrink-0" />
              <div className="typo-body text-foreground">
                <p className="font-medium text-status-error/90 mb-1">{s.error_label}</p>
                <p>{dp.errorMsg}</p>
              </div>
            </div>
          )}
        </div>
      </ContentBody>
    </ContentBox>
  );
}
