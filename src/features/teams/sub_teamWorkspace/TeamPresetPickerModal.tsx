import { useEffect, useState } from 'react';
import { Layers, X } from 'lucide-react';
import { BaseModal } from '@/lib/ui/BaseModal';
import { Button } from '@/features/shared/components/buttons';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import EmptyState from '@/features/shared/components/feedback/EmptyState';
import { PresetCard } from '@/features/templates/sub_presets';
import { listTeamPresets } from '@/api/templates/teamPresets';
import { silentCatch } from '@/lib/silentCatch';
import { useTranslation } from '@/i18n/useTranslation';
import type { TeamPreset } from '@/lib/bindings/TeamPreset';

interface TeamPresetPickerModalProps {
  open: boolean;
  onClose: () => void;
  /** Fired when the user picks a preset — the caller opens the preview/adoption modal. */
  onSelect: (preset: TeamPreset) => void;
}

/**
 * Onboarding gallery for starting a team from a pre-wired, best-practice
 * preset (e.g. the Web Development Team). Lists every filesystem-shipped
 * `TeamPreset`; picking one hands it back to the caller, which opens the
 * existing `PresetPreviewModal` where the user selects/unselects members,
 * optionally customizes them, and adopts.
 *
 * Read-fresh-from-disk on open — mirrors `PresetLibraryPage` (presets are
 * rarely listed and dev-time stale-cache annoyance is real).
 */
export function TeamPresetPickerModal({ open, onClose, onSelect }: TeamPresetPickerModalProps) {
  const { t } = useTranslation();
  const [presets, setPresets] = useState<TeamPreset[] | null>(null);

  useEffect(() => {
    if (!open) return;
    setPresets(null);
    listTeamPresets()
      .then(setPresets)
      .catch((err) => {
        silentCatch('TeamPresetPickerModal:list')(err);
        setPresets([]);
      });
  }, [open]);

  return (
    <BaseModal
      isOpen={open}
      onClose={onClose}
      titleId="team-preset-picker-title"
      size="lg"
      portal
      panelClassName="bg-background border border-primary/15 rounded-2xl shadow-elevation-4 overflow-hidden flex flex-col max-h-[85vh]"
    >
      <div className="px-5 pt-5 pb-3 border-b border-primary/10 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-card bg-indigo-500/15 border border-indigo-500/25 flex items-center justify-center flex-shrink-0">
            <Layers className="w-4 h-4 text-indigo-400" />
          </div>
          <div className="min-w-0">
            <h2 id="team-preset-picker-title" className="typo-heading font-semibold text-foreground/90">
              {t.pipeline.preset_team_picker_title}
            </h2>
            <p className="typo-caption text-foreground">{t.pipeline.preset_team_picker_subtitle}</p>
          </div>
        </div>
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label={t.common.close}>
          <X className="w-4 h-4" />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4" data-testid="team-preset-picker">
        {presets === null && (
          <div className="flex items-center justify-center gap-2 py-10 text-foreground typo-body">
            <LoadingSpinner size="sm" />
            <span>{t.templates.presets.loading}</span>
          </div>
        )}

        {presets && presets.length === 0 && (
          <EmptyState
            icon={Layers}
            title={t.templates.presets.empty_title}
            description={t.templates.presets.empty_hint}
          />
        )}

        {presets && presets.length > 0 && (
          <div
            className="grid gap-4"
            style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}
          >
            {presets.map((p) => (
              <PresetCard key={p.id} preset={p} onOpen={() => onSelect(p)} />
            ))}
          </div>
        )}
      </div>
    </BaseModal>
  );
}
