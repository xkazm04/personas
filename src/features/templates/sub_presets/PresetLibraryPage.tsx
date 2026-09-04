import { useEffect, useMemo, useState } from 'react';
import { Layers, Users } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { useIsDarkTheme } from '@/stores/themeStore';
import type { TeamPreset } from '@/lib/bindings/TeamPreset';
import { listTeamPresets } from '@/api/templates/teamPresets';
import { silentCatch } from '@/lib/silentCatch';
import { colorWithAlpha } from '@/lib/utils/colorWithAlpha';
import { RevealItem } from '@/features/shared/components/display/RevealItem';
import { useRevealTracker } from '@/hooks/utility/interaction/useProgressiveReveal';
import { PresetPreviewModal } from './PresetPreviewModal';

/** Preset ids that ship a symbolic Leonardo illustration (dark + light). Other
 *  presets fall back to a color-gradient tile. */
const PRESET_ART = new Set([
  'backlog-execution', 'sdlc-lifecycle', 'web-development',
]);
function presetArt(id: string, isDark: boolean): string | null {
  if (!PRESET_ART.has(id)) return null;
  return `/illustrations/presets/preset-${id}-${isDark ? 'dark' : 'light'}.png`;
}

/** Data-weighted bento spans by rank (largest team = hero tile). */
const SPANS = ['sm:col-span-2 sm:row-span-2', 'sm:col-span-2', 'sm:row-span-2'];
/** Ghost tile spans — same rhythm as SPANS, cycled across a calm 7-tile mosaic. */
const GHOST_SPANS = ['sm:col-span-2 sm:row-span-2', 'sm:col-span-2', '', 'sm:row-span-2', '', 'sm:col-span-2', ''];

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

  // ── Loading choreography (docs/design/overview-loading.md) ──
  // A single cold read on mount (no filter context), so one static reveal key
  // is enough — entered ids latch so a remount that finds the store already
  // warm never replays the cascade. Ghosts paint only while the read is still
  // in flight AND there is nothing on screen yet; the header renders on every
  // frame regardless.
  const enter = useRevealTracker('presets');
  const showGhost = presets === null;

  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-6" data-testid="preset-library-page">
      <div className="max-w-5xl mx-auto">
        <header className="mb-5">
          <h1 className="typo-heading-lg text-foreground/90">{t.templates.presets.page_title}</h1>
          <p className="typo-body text-foreground mt-1">{t.templates.presets.page_subtitle}</p>
        </header>

        {showGhost ? (
          <PresetGhostTiles />
        ) : ranked.length === 0 ? (
          <div className="text-center py-12">
            <Layers className="w-10 h-10 mx-auto text-foreground mb-3" />
            <h2 className="typo-heading-lg text-foreground/90 mb-1">{t.templates.presets.empty_title}</h2>
            <p className="typo-body text-foreground max-w-md mx-auto">{t.templates.presets.empty_hint}</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 auto-rows-[130px] gap-3">
            {ranked.map((p, idx) => (
              <RevealItem
                key={p.id}
                revealId={p.id}
                order={idx}
                hasEntered={enter.hasEntered}
                markEntered={enter.markEntered}
                className={SPANS[idx] ?? ''}
              >
                <PresetTile
                  preset={p}
                  art={presetArt(p.id, isDark)}
                  big={idx === 0}
                  memberLabel={tx(
                    p.members.length === 1
                      ? t.templates.presets.card_member_count_one
                      : t.templates.presets.card_member_count_other,
                    { count: p.members.length },
                  )}
                  onOpen={() => setOpenPreset(p)}
                />
              </RevealItem>
            ))}
          </div>
        )}
      </div>

      {openPreset && (
        <PresetPreviewModal open preset={openPreset} onClose={() => setOpenPreset(null)} />
      )}
    </div>
  );
}

function PresetTile({ preset, art, big, memberLabel, onOpen }: {
  preset: TeamPreset; art: string | null; big: boolean; memberLabel: string; onOpen: () => void;
}) {
  const color = preset.color || '#6366f1';
  return (
    <button
      type="button"
      onClick={onOpen}
      data-testid={`preset-card-${preset.id}`}
      className="group relative w-full h-full overflow-hidden rounded-2xl border border-primary/10 hover:border-primary/30 text-left transition-all"
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

// ---------------------------------------------------------------------------
// PresetGhostTiles — calm delayed ghost of the bento mosaic, shown only while
// the cold filesystem read is in flight and nothing is on screen yet. Each
// tile fades in (`animate-fade-in`, fill-mode both) behind a ≥120ms staggered
// delay so a fast read never paints a single one; real tiles replace them the
// frame data lands and play their own one-shot cascade in the same geometry.
// No `animate-pulse` — the entrance stagger is the only motion.
// ---------------------------------------------------------------------------
function PresetGhostTiles() {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 auto-rows-[130px] gap-3" aria-hidden="true">
      {GHOST_SPANS.map((span, i) => (
        <div
          key={i}
          className={`rounded-2xl border border-primary/10 bg-primary/[0.04] animate-fade-in ${span}`}
          style={{ animationDelay: `${120 + i * 35}ms` }}
        >
          <div className="h-full flex flex-col justify-end p-3.5 gap-1.5">
            <span className="block h-3.5 w-2/3 max-w-[9rem] rounded bg-primary/[0.08]" />
            <span className="block h-2.5 w-1/3 max-w-[5rem] rounded bg-primary/[0.08]" />
          </div>
        </div>
      ))}
    </div>
  );
}
