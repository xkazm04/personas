/**
 * Compact pill rendered in the Glyph card header, surfacing the recommended
 * Claude model for that capability. Color-coded by tier so a glance across
 * a multi-capability persona shows where the build distributed reasoning
 * effort.
 *
 * Tooltip exposes the full `model_rationale` so the user can audit the
 * pick. Renders nothing when no model has been recommended yet (e.g.
 * during initial build phases before Phase D fires).
 */
import { Sparkles } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';

interface ModelBadgeProps {
  /** Bare Claude model id (`"claude-sonnet-4-6"`, etc.) or null. */
  model: string | null;
  /** Human-readable rationale; rendered as the title-attribute tooltip. */
  rationale: string | null;
}

interface ModelTier {
  /** Anthropic product name, rendered verbatim in every locale — `Haiku`,
   *  `Sonnet` and `Opus` are brands, not UI copy. `null` means no brand
   *  matched, and the badge falls back to the localized generic label. This
   *  separation is the point: the label used to be co-authored with the
   *  colour classes, which is how a plain English word ("Custom") ended up
   *  hardcoded beside three names that correctly are. */
  brand: 'Haiku' | 'Sonnet' | 'Opus' | null;
  textColor: string;
  bgColor: string;
  borderColor: string;
}

/** Map a Claude model id to its display tier. The matcher is intentionally
 *  loose — any future Haiku/Sonnet/Opus variant should map cleanly without
 *  needing this file changed. Unrecognized ids fall through to a neutral
 *  badge so the user still sees *something* useful. */
function resolveTier(model: string): ModelTier {
  const lower = model.toLowerCase();
  if (lower.includes('haiku')) {
    return {
      brand: 'Haiku',
      textColor: 'text-sky-300',
      bgColor: 'bg-sky-500/15',
      borderColor: 'border-sky-500/40',
    };
  }
  if (lower.includes('opus')) {
    return {
      brand: 'Opus',
      textColor: 'text-amber-300',
      bgColor: 'bg-amber-500/15',
      borderColor: 'border-amber-500/40',
    };
  }
  if (lower.includes('sonnet')) {
    return {
      brand: 'Sonnet',
      textColor: 'text-violet-300',
      bgColor: 'bg-violet-500/15',
      borderColor: 'border-violet-500/40',
    };
  }
  return {
    brand: null,
    textColor: 'text-foreground',
    bgColor: 'bg-foreground/10',
    borderColor: 'border-foreground/25',
  };
}

export function ModelBadge({ model, rationale }: ModelBadgeProps) {
  const { t } = useTranslation();
  if (!model) return null;
  const tier = resolveTier(model);
  const label = tier.brand ?? t.templates.chronology.model_tier_custom;
  // Compose the tooltip: full model id on top, rationale below. The `\n`
  // renders as a line break in native title-attribute tooltips on most
  // platforms; consumers wanting richer rendering can wrap this in their
  // own popover.
  const tooltip = rationale ? `${model}\n\n${rationale}` : model;
  return (
    <span
      title={tooltip}
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border typo-label font-bold shrink-0 ${tier.bgColor} ${tier.borderColor} ${tier.textColor}`}
    >
      <Sparkles className="w-3 h-3" />
      {label}
    </span>
  );
}
