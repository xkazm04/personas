import { ArrowRight, Users } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { colorWithAlpha } from '@/lib/utils/colorWithAlpha';
import { presetBackgroundImage, presetGradient } from './presetBackground';
import type { PresetGalleryVariantProps } from './types';

/**
 * SHOWCASE — every preset is a poster.
 *
 * A responsive grid of large cards, each led by its own unique
 * illustration (generated per team via /leonardo; gradient fallback from
 * the team's accent). The illustration is a header band so the title +
 * roster + description sit on a solid panel below in full-contrast tokens
 * (no text-over-image legibility tax). Because we ship only a handful of
 * presets, each one earns a full, distinct visual rather than a dense row.
 */
export function PresetGalleryShowcase({ presets, onPick }: PresetGalleryVariantProps) {
  return (
    <div
      className="grid gap-5 max-w-5xl mx-auto"
      style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))' }}
    >
      {presets.map((p) => (
        <ShowcaseCard key={p.id} preset={p} onPick={() => onPick(p)} />
      ))}
    </div>
  );
}

function ShowcaseCard({ preset, onPick }: { preset: import('@/lib/bindings/TeamPreset').TeamPreset; onPick: () => void }) {
  const { t, tx } = useTranslation();
  const color = preset.team.color ?? preset.color;
  const image = presetBackgroundImage(preset.id);

  return (
    <button
      type="button"
      onClick={onPick}
      data-testid={`preset-showcase-${preset.id}`}
      className="group text-left rounded-modal border border-primary/15 bg-secondary/20 overflow-hidden flex flex-col transition-all hover:border-primary/30 hover:shadow-elevation-2"
    >
      {/* Illustration header */}
      <div
        className="relative h-40 flex-shrink-0"
        style={{
          backgroundImage: image ? `url(${image})` : presetGradient(color),
          backgroundColor: image ? undefined : colorWithAlpha(color, 0.06),
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }}
      >
        <span className="absolute inset-x-0 top-0 h-1" style={{ backgroundColor: color }} />
      </div>

      {/* Solid content panel */}
      <div className="flex-1 p-4 flex flex-col gap-2">
        <h3 className="typo-heading font-semibold text-foreground/90">{preset.name}</h3>
        <p className="typo-body text-foreground line-clamp-2 leading-snug">{preset.description}</p>
        <div className="mt-auto pt-2 flex items-center justify-between">
          <span className="inline-flex items-center gap-1.5 typo-caption text-foreground">
            <Users className="w-3.5 h-3.5" />
            {tx(
              preset.members.length === 1
                ? t.templates.presets.card_member_count_one
                : t.templates.presets.card_member_count_other,
              { count: preset.members.length },
            )}
          </span>
          <span
            className="inline-flex items-center gap-1 typo-caption font-medium transition-transform group-hover:translate-x-0.5"
            style={{ color }}
          >
            {t.pipeline.preset_setup_cta}
            <ArrowRight className="w-3.5 h-3.5" />
          </span>
        </div>
      </div>
    </button>
  );
}
