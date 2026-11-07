import { Bot, Users, KeyRound, FolderGit2, BookOpen, Fingerprint, Sparkles, PackageOpen } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { ExportPicker } from './types';
import {
  CategoryCountRow,
  KpiSetupCard,
  SecuritySection,
  SecretsStatus,
  DependencyNotes,
  ExportButton,
} from './panels';
import Button from '@/features/shared/components/buttons/Button';

/** Right rail — the live "what ships" summary + packaging controls + CTA. */
export function ManifestCart({
  picker,
  exporting,
  onCancel,
}: {
  picker: ExportPicker;
  exporting: boolean;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const s = t.settings.portability;
  const p = s.proto;

  return (
    <aside className="w-[340px] flex-shrink-0 border-l border-hair bg-secondary/5 flex flex-col">
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <div className="flex items-center gap-2.5">
          <span className="w-9 h-9 rounded-card flex items-center justify-center bg-status-success/10 text-status-success flex-shrink-0">
            <PackageOpen className="w-4.5 h-4.5" />
          </span>
          <div className="min-w-0">
            <h3 className="typo-heading text-foreground">{p.manifest_title}</h3>
            <span
              className={`typo-caption ${picker.isFullExport ? 'text-status-success' : 'text-foreground'}`}
            >
              {picker.isFullExport ? p.manifest_full : p.manifest_subtitle}
            </span>
          </div>
        </div>

        {picker.totalSelected === 0 ? (
          <p className="typo-caption text-foreground">{p.manifest_empty}</p>
        ) : (
          <div className="space-y-2.5">
            <CategoryCountRow icon={Bot} label={p.row_personas} {...picker.counts.personas} accent="bg-role-agent/10 text-role-agent" />
            <CategoryCountRow icon={Users} label={p.row_teams} {...picker.counts.teams} accent="bg-status-info/10 text-status-info" />
            <CategoryCountRow icon={KeyRound} label={p.row_credentials} {...picker.counts.credentials} accent="bg-status-warning/10 text-status-warning" />
            <CategoryCountRow icon={FolderGit2} label={p.row_projects} {...picker.counts.projects} accent="bg-status-success/10 text-status-success" />
            <CategoryCountRow icon={BookOpen} label={p.row_knowledge} {...picker.counts.knowledge} accent="bg-role-agent/10 text-role-agent" />
            <CategoryCountRow icon={Fingerprint} label={p.row_twins} {...picker.counts.twins} accent="bg-status-error/10 text-status-error" />
            <CategoryCountRow icon={Sparkles} label={p.row_athena} {...picker.counts.athena} accent="bg-role-agent/10 text-role-agent" />
          </div>
        )}

        <div className="h-px bg-primary/8" />

        <KpiSetupCard picker={picker} />
        <SecuritySection picker={picker} />
        <DependencyNotes />
      </div>

      {/* Pinned CTA */}
      <div className="p-4 border-t border-hair bg-background/40 space-y-2.5">
        <SecretsStatus picker={picker} />
        <ExportButton picker={picker} exporting={exporting} onClick={picker.commit} className="w-full" />
        <Button
          type="button"
          onClick={onCancel}
          disabled={exporting}
          variant="ghost"
          size="md"
          className="w-full"
        >
          {s.cancel}
        </Button>
      </div>
    </aside>
  );
}
