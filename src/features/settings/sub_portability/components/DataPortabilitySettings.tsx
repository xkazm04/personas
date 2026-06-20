import { HardDriveDownload, AlertTriangle, Boxes, Download, ShieldCheck, HardDrive, Bot, Users, Wrench, KeyRound, Brain, BrainCircuit, FlaskConical, Target, type LucideIcon } from 'lucide-react';
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
      <div className="flex items-center justify-center gap-1.5 rounded-card border border-primary/10 bg-secondary/10 px-2 py-1.5">
        <Icon className={`w-4 h-4 flex-shrink-0 ${accent}`} aria-hidden />
        <span className="typo-heading font-semibold text-foreground tabular-nums">{value}</span>
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
      icon: <Boxes className="w-4 h-4 text-emerald-400" />,
      content: (
        <div className="space-y-4">
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
            <div className="flex flex-wrap gap-2">
              <StatBadge icon={Bot} label={s.personas} value={dp.stats.persona_count} accent="text-emerald-400" />
              <StatBadge icon={Users} label={s.teams} value={dp.stats.team_count} accent="text-blue-400" />
              <StatBadge icon={Wrench} label={s.tools} value={dp.stats.tool_count} accent="text-amber-400" />
              <StatBadge icon={KeyRound} label={s.credentials} value={dp.stats.credential_count} accent="text-violet-400" />
              <StatBadge icon={Brain} label={s.memories} value={dp.stats.memory_count} accent="text-cyan-400" />
              <StatBadge icon={BrainCircuit} label={s.team_memories} value={dp.stats.team_memory_count} accent="text-teal-400" />
              <StatBadge icon={FlaskConical} label={s.test_suites} value={dp.stats.test_suite_count} accent="text-rose-400" />
              <StatBadge icon={Target} label={s.kpis} value={dp.stats.kpi_count} accent="text-pink-400" />
            </div>
          )}
        </div>
      ),
    },
    {
      id: 'export',
      label: s.export_import_title,
      icon: <Download className="w-4 h-4 text-blue-400" />,
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
        />
      ),
    },
    {
      id: 'credentials',
      label: s.credential_vault,
      icon: <ShieldCheck className="w-4 h-4 text-amber-400" />,
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
        />
      ),
    },
    {
      id: 'storage',
      label: s.storage_title,
      subtitle: s.storage_subtitle,
      icon: <HardDrive className="w-4 h-4 text-sky-400" />,
      content: <StorageUsageSection />,
    },
  ];

  return (
    <ContentBox>
      <ContentHeader
        icon={<HardDriveDownload className="w-5 h-5 text-emerald-400" />}
        iconColor="emerald"
        title={s.title}
        subtitle={s.subtitle}
      />

      <ContentBody centered>
        <div className="max-w-5xl mx-auto space-y-4">
          <SettingsScaffold sections={sections} navAriaLabel={s.title} />

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
