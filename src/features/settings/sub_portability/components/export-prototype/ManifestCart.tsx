import { Bot, Users, KeyRound, PackageOpen } from 'lucide-react';
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
    <aside className="w-[340px] flex-shrink-0 border-l border-primary/10 bg-secondary/5 flex flex-col">
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <div className="flex items-center gap-2.5">
          <span className="w-9 h-9 rounded-card flex items-center justify-center bg-emerald-500/10 text-emerald-300 flex-shrink-0">
            <PackageOpen className="w-4.5 h-4.5" />
          </span>
          <div className="min-w-0">
            <h3 className="typo-heading font-semibold text-foreground leading-tight">{p.manifest_title}</h3>
            <span
              className={`typo-caption ${picker.isFullExport ? 'text-emerald-300' : 'text-foreground'}`}
            >
              {picker.isFullExport ? p.manifest_full : p.manifest_subtitle}
            </span>
          </div>
        </div>

        {picker.totalSelected === 0 ? (
          <p className="typo-caption text-foreground leading-relaxed">{p.manifest_empty}</p>
        ) : (
          <div className="space-y-2.5">
            <CategoryCountRow icon={Bot} label={p.row_personas} {...picker.counts.personas} accent="bg-violet-500/10 text-violet-300" />
            <CategoryCountRow icon={Users} label={p.row_teams} {...picker.counts.teams} accent="bg-sky-500/10 text-sky-300" />
            <CategoryCountRow icon={KeyRound} label={p.row_credentials} {...picker.counts.credentials} accent="bg-amber-500/10 text-amber-300" />
          </div>
        )}

        <div className="h-px bg-primary/8" />

        <KpiSetupCard picker={picker} />
        <SecuritySection picker={picker} />
        <DependencyNotes />
      </div>

      {/* Pinned CTA */}
      <div className="p-4 border-t border-primary/10 bg-background/40 space-y-2.5">
        <SecretsStatus picker={picker} />
        <ExportButton picker={picker} exporting={exporting} onClick={picker.commit} className="w-full" />
        <button
          onClick={onCancel}
          disabled={exporting}
          className="w-full py-2 rounded-modal typo-caption font-medium text-foreground hover:text-foreground transition-colors disabled:opacity-50"
        >
          {s.cancel}
        </button>
      </div>
    </aside>
  );
}
