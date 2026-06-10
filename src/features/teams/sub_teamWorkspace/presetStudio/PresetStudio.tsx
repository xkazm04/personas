import { useEffect, useState } from 'react';
import { ArrowLeft, Layers } from 'lucide-react';
import { ContentBox, ContentHeader } from '@/features/shared/components/layout/ContentLayout';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import EmptyState from '@/features/shared/components/feedback/EmptyState';
import { PresetCard } from '@/features/templates/sub_presets';
import { listTeamPresets } from '@/api/templates/teamPresets';
import { silentCatch } from '@/lib/silentCatch';
import { useTranslation } from '@/i18n/useTranslation';
import { usePipelineStore } from '@/stores/pipelineStore';
import { colorWithAlpha } from '@/lib/utils/colorWithAlpha';
import type { TeamPreset } from '@/lib/bindings/TeamPreset';
import { PresetProcessHost } from './PresetProcessHost';

/**
 * In-app preset-adoption flow for the Teams section — the migration of
 * the old `TeamPresetPickerModal` + `PresetPreviewModal` pair into full
 * content space. Two stages:
 *
 *   gallery  → best-practice presets as cards (reuses `PresetCard`).
 *   process  → the chosen preset's adoption process (`PresetProcessHost`),
 *              currently A/B-ing directional variants behind a tab strip.
 *
 * Rendered by `TeamCanvas` when `pipelineStore.presetFlowOpen` is true.
 */
export function PresetStudio() {
  const { t } = useTranslation();
  const setPresetFlowOpen = usePipelineStore((s) => s.setPresetFlowOpen);
  const selectTeam = usePipelineStore((s) => s.selectTeam);

  const [presets, setPresets] = useState<TeamPreset[] | null>(null);
  const [chosen, setChosen] = useState<TeamPreset | null>(null);

  useEffect(() => {
    listTeamPresets()
      .then(setPresets)
      .catch((err) => {
        silentCatch('PresetStudio:list')(err);
        setPresets([]);
      });
  }, []);

  // ---- Process stage ----
  if (chosen) {
    const teamColor = chosen.team.color ?? chosen.color;
    return (
      <ContentBox minWidth={0} data-testid="preset-studio-process">
        <ContentHeader
          icon={
            <span
              className="w-9 h-9 rounded-card border flex items-center justify-center flex-shrink-0"
              style={{ backgroundColor: colorWithAlpha(teamColor, 0.15), borderColor: colorWithAlpha(teamColor, 0.35) }}
            >
              <Layers className="w-5 h-5" style={{ color: teamColor }} />
            </span>
          }
          title={chosen.name}
          subtitle={chosen.description}
          actions={
            <button
              type="button"
              onClick={() => setChosen(null)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-interactive border border-primary/20 bg-secondary/30 typo-body font-medium text-foreground hover:bg-secondary/50 transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              {t.pipeline.preset_back_to_gallery}
            </button>
          }
        />
        <PresetProcessHost
          preset={chosen}
          onOpenTeam={(result) => {
            setPresetFlowOpen(false);
            selectTeam(result.team_id);
          }}
        />
      </ContentBox>
    );
  }

  // ---- Gallery stage ----
  return (
    <ContentBox minWidth={0} data-testid="preset-studio-gallery">
      <ContentHeader
        icon={<Layers className="w-5 h-5 text-indigo-300" />}
        iconColor="indigo"
        title={t.pipeline.preset_team_picker_title}
        subtitle={t.pipeline.preset_team_picker_subtitle}
        actions={
          <button
            type="button"
            onClick={() => setPresetFlowOpen(false)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-interactive border border-primary/20 bg-secondary/30 typo-body font-medium text-foreground hover:bg-secondary/50 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            {t.pipeline.team_studio.teams_header_label}
          </button>
        }
      />
      <div className="flex-1 min-h-0 overflow-y-auto px-6 py-5" data-testid="preset-studio-grid">
        {presets === null && (
          <div className="flex items-center justify-center gap-2 py-12 text-foreground typo-body">
            <LoadingSpinner size="sm" />
            <span>{t.templates.presets.loading}</span>
          </div>
        )}
        {presets && presets.length === 0 && (
          <EmptyState icon={Layers} title={t.templates.presets.empty_title} description={t.templates.presets.empty_hint} />
        )}
        {presets && presets.length > 0 && (
          <div className="grid gap-4 max-w-5xl mx-auto" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}>
            {presets.map((p) => (
              <PresetCard key={p.id} preset={p} onOpen={() => setChosen(p)} />
            ))}
          </div>
        )}
      </div>
    </ContentBox>
  );
}
