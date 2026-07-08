import { useEffect, useMemo, useState } from 'react';
import { Layers, Users } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { useIsDarkTheme } from '@/stores/themeStore';
import type { TeamPreset } from '@/lib/bindings/TeamPreset';
import { listTeamPresets } from '@/api/templates/teamPresets';
import { silentCatch } from '@/lib/silentCatch';
import { colorWithAlpha } from '@/lib/utils/colorWithAlpha';
import { PresetPreviewModal } from './PresetPreviewModal';

/** Preset ids that ship a symbolic Leonardo illustration (dark + light). Other
 *  presets fall back to a color-gradient tile. */
const PRESET_ART = new Set([
  'backlog-execution', 'daily-ops', 'engineering-triage',
  'reflective-journaling', 'sdlc-lifecycle', 'web-development',
]);
function presetArt(id: string, isDark: boolean): string | null {
  if (!PRESET_ART.has(id)) return null;
  return `/illustrations/presets/preset-${id}-${isDark ? 'dark' : 'light'}.png`;
}

/** Data-weighted bento spans by rank (largest team = hero tile). */
const SPANS = ['sm:col-span-2 sm:row-span-2', 'sm:col-span-2', 'sm:row-span-2'];

/**
 * Top-level page for the Templates → Presets tab. Renders every
 * filesystem-shipped preset as a data-weighted Bento mosaic (tile size scales
 * with team size); clicking a tile opens the preview/adoption modal.
 *
 * Read-fresh-from-disk on mount — see `team_preset_loader` for the rationale.
 */
export default function PresetLibraryPage() {
  const { t, tx } = useTranslation();
  const isDark = useIsDarkTheme();
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

  const ranked = useMemo(
    () => (presets ? [...presets].sort((a, b) => b.members.length - a.members.length) : []),
    [presets],
  );

  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-6" data-testid="preset-library-page">
      <div className="max-w-5xl mx-auto">
        {presets === null && (
          <p className="typo-body text-foreground text-center py-8">{t.templates.presets.loading}</p>
        )}

        {presets && presets.length === 0 && (
          <div className="text-center py-12">
            <Layers className="w-10 h-10 mx-auto text-foreground mb-3" />
            <h2 className="typo-heading-lg text-foreground/90 mb-1">{t.templates.presets.empty_title}</h2>
            <p className="typo-body text-foreground max-w-md mx-auto">{t.templates.presets.empty_hint}</p>
          </div>
        )}

        {presets && presets.length > 0 && (
          <>
            <header className="mb-5">
              <h1 className="typo-heading-lg text-foreground/90">{t.templates.presets.page_title}</h1>
              <p className="typo-body text-foreground mt-1">{t.templates.presets.page_subtitle}</p>
            </header>

            <div className="grid grid-cols-2 sm:grid-cols-4 auto-rows-[130px] gap-3">
              {ranked.map((p, idx) => (
                <PresetTile
                  key={p.id}
                  preset={p}
                  art={presetArt(p.id, isDark)}
                  span={SPANS[idx] ?? ''}
                  big={idx === 0}
                  memberLabel={tx(
                    p.members.length === 1
                      ? t.templates.presets.card_member_count_one
                      : t.templates.presets.card_member_count_other,
                    { count: p.members.length },
                  )}
                  onOpen={() => setOpenPreset(p)}
                />
              ))}
            </div>
          </>
        )}
      </div>

      {openPreset && (
        <PresetPreviewModal open preset={openPreset} onClose={() => setOpenPreset(null)} />
      )}
    </div>
  );
}

function PresetTile({ preset, art, span, big, memberLabel, onOpen }: {
  preset: TeamPreset; art: string | null; span: string; big: boolean; memberLabel: string; onOpen: () => void;
}) {
  const color = preset.color || '#6366f1';
  return (
    <button
      type="button"
      onClick={onOpen}
      data-testid={`preset-card-${preset.id}`}
      className={`group relative overflow-hidden rounded-2xl border border-primary/10 hover:border-primary/30 text-left transition-all ${span}`}
    >
      {art ? (
        <img src={art} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover opacity-45 group-hover:opacity-70 group-hover:scale-105 transition-all duration-500" />
      ) : (
        <div className="absolute inset-0" style={{ background: `radial-gradient(120% 90% at 70% 15%, ${colorWithAlpha(color, 0.28)}, transparent 70%)` }} />
      )}
      <div className="absolute inset-0" style={{ background: `linear-gradient(to top, var(--background) 16%, transparent 62%), radial-gradient(120% 80% at 70% 20%, ${colorWithAlpha(color, 0.13)}, transparent)` }} />
      <div className="relative h-full flex flex-col justify-end p-3.5 gap-0.5">
        <span className={`text-foreground drop-shadow-[0_1px_4px_rgba(0,0,0,0.5)] ${big ? 'typo-heading-lg' : 'typo-heading'}`}>{preset.name}</span>
        <span className="inline-flex items-center gap-1 typo-caption text-foreground opacity-80">
          <Users className="w-3.5 h-3.5" style={{ color }} />
          {memberLabel}
        </span>
      </div>
    </button>
  );
}
