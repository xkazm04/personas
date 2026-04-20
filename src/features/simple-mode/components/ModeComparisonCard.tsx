import { Check, Sparkles, LayoutGrid } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { isTierAvailable, type Tier } from '@/lib/constants/uiModes';

/**
 * Reusable mode-comparison card rendering one Simple-vs-Power option with a
 * three-bullet preview. Used in Settings → Appearance → Interface mode, and
 * (Phase 12) the onboarding tour + graduate-to-Power confirmation modal.
 *
 * Tone: Simple = violet accent, Power = amber accent (the Graduate CTA in
 * 05-01 already uses violet, so Simple = violet stays visually consistent).
 */
export interface ModeComparisonCardProps {
  /** The tier this card represents. Dev tier is compile-gated and not exposed here. */
  mode: Extract<Tier, 'starter' | 'team'>;
  /** Whether this is the currently active view mode. */
  isActive: boolean;
  /** Called on card click. Parent decides whether to call setViewMode directly
   *  (Settings) or open a confirmation modal first (Phase 12). */
  onSelect: () => void;
  /** Optional: render in a compact variant (tighter spacing, smaller icon well). */
  compact?: boolean;
}

export function ModeComparisonCard({
  mode,
  isActive,
  onSelect,
  compact = false,
}: ModeComparisonCardProps) {
  const { t } = useTranslation();
  const m = t.simple_mode.modes;
  const isSimple = mode === 'starter';
  const tone = isSimple ? 'violet' : 'amber';
  const Icon = isSimple ? Sparkles : LayoutGrid;

  const title = isSimple ? m.simple_title : m.power_title;
  const subtitle = isSimple ? m.simple_subtitle : m.power_subtitle;
  const bullets = isSimple
    ? [m.simple_bullet_1, m.simple_bullet_2, m.simple_bullet_3]
    : [m.power_bullet_1, m.power_bullet_2, m.power_bullet_3];

  const available = isTierAvailable(mode as Tier);

  const accentBorder = `simple-accent-${tone}-border`;
  const accentSoft = `simple-accent-${tone}-soft`;
  const accentText = `simple-accent-${tone}-text`;

  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={!available}
      aria-pressed={isActive}
      aria-label={`${title} — ${isActive ? m.active_badge : m.switch_cta}`}
      className={
        `relative text-left rounded-modal border-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed ` +
        (compact ? 'p-3 ' : 'p-5 ') +
        (isActive
          ? `${accentBorder} ${accentSoft}`
          : 'border-primary/10 hover:border-primary/20 hover:bg-foreground/[0.02]')
      }
    >
      <div className="flex items-start gap-3">
        <div
          className={
            `shrink-0 rounded-2xl border flex items-center justify-center ${accentSoft} ${accentBorder} ` +
            (compact ? 'w-8 h-8' : 'w-10 h-10')
          }
        >
          <Icon className={`${accentText} ${compact ? 'w-4 h-4' : 'w-5 h-5'}`} />
        </div>
        <div className="flex-1 min-w-0">
          <div
            className={`${compact ? 'typo-heading' : 'typo-heading-lg'} simple-display text-foreground`}
          >
            {title}
          </div>
          <div
            className={`${compact ? 'typo-caption' : 'typo-body'} text-foreground/60 mt-0.5`}
          >
            {subtitle}
          </div>
        </div>
        {isActive && (
          <span
            className={`shrink-0 typo-caption px-2 py-0.5 rounded-full border ${accentText} ${accentBorder} ${accentSoft}`}
          >
            {m.active_badge}
          </span>
        )}
      </div>

      <ul className={`mt-3 space-y-1.5 ${compact ? 'text-[12px]' : ''}`}>
        {bullets.map((b, i) => (
          <li key={i} className="flex items-start gap-2">
            <Check
              className={`shrink-0 mt-0.5 ${accentText} ${compact ? 'w-3 h-3' : 'w-3.5 h-3.5'}`}
            />
            <span className="typo-body text-foreground/80">{b}</span>
          </li>
        ))}
      </ul>
    </button>
  );
}
