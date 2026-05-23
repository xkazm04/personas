import { useEffect, useState } from 'react';
import { Layers } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { TeamPreset } from '@/lib/bindings/TeamPreset';
import { listTeamPresets } from '@/api/templates/teamPresets';
import { silentCatch } from '@/lib/silentCatch';
import { colorWithAlpha } from '@/lib/utils/colorWithAlpha';
import { PresetPreviewModal } from './PresetPreviewModal';

/**
 * Top-level page for the Templates → Presets tab. Renders every
 * filesystem-shipped preset as a card; clicking a card opens the
 * preview/adoption modal.
 *
 * Read-fresh-from-disk on mount — see `team_preset_loader` for the
 * rationale (presets are rarely listed, dev-time stale-cache annoyance
 * is real). Empty state when there's no manifest yet so a fresh install
 * isn't a blank page.
 */
export default function PresetLibraryPage() {
  const { t } = useTranslation();
  const [presets, setPresets] = useState<TeamPreset[] | null>(null);
  const [openPreset, setOpenPreset] = useState<TeamPreset | null>(null);

  useEffect(() => {
    listTeamPresets()
      .then(setPresets)
      .catch((err) => {
        silentCatch('PresetLibraryPage:list')(err);
        setPresets([]);
      });
  }, []);

  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-6" data-testid="preset-library-page">
      <div className="max-w-5xl mx-auto">
        {presets === null && (
          <p className="typo-body text-foreground/60 text-center py-8">
            {t.templates.presets.loading}
          </p>
        )}

        {presets && presets.length === 0 && (
          <div className="text-center py-12">
            <Layers className="w-10 h-10 mx-auto text-foreground/30 mb-3" />
            <h2 className="typo-heading-lg font-semibold text-foreground/90 mb-1">
              {t.templates.presets.empty_title}
            </h2>
            <p className="typo-body text-foreground max-w-md mx-auto">
              {t.templates.presets.empty_hint}
            </p>
          </div>
        )}

        {presets && presets.length > 0 && (
          <>
            <header className="mb-5">
              <h1 className="typo-heading-lg font-bold text-foreground/90">
                {t.templates.presets.page_title}
              </h1>
              <p className="typo-body text-foreground mt-1">
                {t.templates.presets.page_subtitle}
              </p>
            </header>

            <div
              className="grid gap-4"
              style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))' }}
            >
              {presets.map((p) => (
                <PresetCard
                  key={p.id}
                  preset={p}
                  onOpen={() => setOpenPreset(p)}
                />
              ))}
            </div>
          </>
        )}
      </div>

      {openPreset && (
        <PresetPreviewModal
          open
          preset={openPreset}
          onClose={() => setOpenPreset(null)}
        />
      )}
    </div>
  );
}

function PresetCard({
  preset,
  onOpen,
}: {
  preset: TeamPreset;
  onOpen: () => void;
}) {
  const { t, tx } = useTranslation();
  const color = preset.color || '#6366f1';
  return (
    <button
      type="button"
      onClick={onOpen}
      data-testid={`preset-card-${preset.id}`}
      className="group text-left p-4 rounded-modal bg-secondary/30 backdrop-blur-sm border border-primary/15 hover:border-indigo-500/30 transition-all hover:shadow-[0_0_20px_rgba(99,102,241,0.08)]"
    >
      <div
        className="absolute-top-strip h-[2px] rounded-full opacity-60 mb-3"
        style={{ backgroundColor: color }}
      />
      <div className="flex items-start gap-3 mb-3">
        <div
          className="w-10 h-10 rounded-modal flex items-center justify-center border flex-shrink-0"
          style={{
            backgroundColor: colorWithAlpha(color, 0.1),
            borderColor: colorWithAlpha(color, 0.25),
          }}
        >
          <Layers className="w-5 h-5" style={{ color }} />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="typo-heading font-semibold text-foreground/90 truncate">{preset.name}</h3>
          <p className="typo-body text-foreground mt-0.5 line-clamp-3">{preset.description}</p>
        </div>
      </div>
      <div className="flex items-center gap-3 typo-caption text-foreground/60">
        <span>
          {tx(
            preset.members.length === 1
              ? t.templates.presets.card_member_count_one
              : t.templates.presets.card_member_count_other,
            { count: preset.members.length },
          )}
        </span>
        {preset.group && (
          <span className="inline-flex items-center gap-1">
            <span
              className="w-1.5 h-1.5 rounded-full"
              style={{ backgroundColor: preset.group.color }}
            />
            {tx(t.templates.presets.card_group_binding, { name: preset.group.name })}
          </span>
        )}
        {preset.category.length > 0 && (
          <span className="ml-auto inline-flex items-center gap-1">
            {preset.category.slice(0, 3).map((c) => (
              <span
                key={c}
                className="px-1.5 py-0.5 rounded-full border border-primary/10 bg-secondary/40 typo-label"
              >
                {c}
              </span>
            ))}
          </span>
        )}
      </div>
    </button>
  );
}
