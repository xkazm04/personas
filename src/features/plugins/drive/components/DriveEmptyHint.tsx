import type { ComponentType, ReactNode } from "react";

/**
 * Shared "expected content not here yet" primitive for the drive plugin.
 * Every empty surface — root-folder empty, search-no-local-hits, column
 * empty, sidebar Recent rail empty — speaks the same visual language:
 * dashed bordered card + icon-in-cyan-square + italic foreground/70 +
 * optional CTA button. Sized by `size` for whichever surface hosts it.
 *
 * Loading states are intentionally NOT routed through this primitive —
 * they have their own (simpler, spinner-flavoured) visual character.
 * "Empty" means "the request returned no content;" "Loading" means
 * "content is on its way." The vocabulary stays distinct.
 */
interface Props {
  icon: ComponentType<{ className?: string }>;
  /**
   * Title is rendered as plain text by default; pass a ReactNode if you
   * need to interpolate emphasis (e.g. user-typed query inside quotes).
   */
  title: ReactNode;
  body?: ReactNode;
  cta?: {
    label: string;
    onClick: () => void;
    icon?: ComponentType<{ className?: string }>;
    disabled?: boolean;
  };
  /**
   * `sm` — inline empty rails (column view, sidebar recent rail).
   * `md` — sub-section empties (currently unused; reserved for future
   *   surfaces that need more weight than sm but less than a page).
   * `lg` — page-level empties (root folder empty, search-escalation CTA).
   */
  size?: "sm" | "md" | "lg";
  className?: string;
}

const SIZES = {
  sm: {
    container: "px-3 py-4 gap-1.5",
    iconBox: "w-7 h-7",
    iconCls: "w-3.5 h-3.5",
    title: "typo-caption",
    body: "typo-caption",
    ctaBase: "px-2.5 py-1 typo-caption",
    ctaIconCls: "w-3 h-3",
  },
  md: {
    container: "px-4 py-5 gap-2",
    iconBox: "w-10 h-10",
    iconCls: "w-4 h-4",
    title: "typo-body font-medium",
    body: "typo-caption",
    ctaBase: "px-3 py-1.5 typo-body",
    ctaIconCls: "w-3.5 h-3.5",
  },
  lg: {
    container: "px-8 py-12 gap-3",
    iconBox: "w-16 h-16",
    iconCls: "w-7 h-7",
    title: "typo-section-title",
    body: "typo-body",
    ctaBase: "px-4 py-2 typo-body",
    ctaIconCls: "w-3.5 h-3.5",
  },
} as const;

export function DriveEmptyHint({
  icon: Icon,
  title,
  body,
  cta,
  size = "md",
  className = "",
}: Props) {
  const s = SIZES[size];
  const CtaIcon = cta?.icon;
  return (
    <div
      className={`flex flex-col items-center justify-center text-center rounded-card border border-dashed border-primary/20 bg-secondary/10 ${s.container} ${className}`}
    >
      <div
        className={`flex items-center justify-center rounded-card bg-cyan-500/10 border border-cyan-500/20 ${s.iconBox}`}
      >
        <Icon className={`${s.iconCls} text-cyan-300`} />
      </div>
      <div className={`${s.title} italic text-foreground`}>{title}</div>
      {body && (
        <div
          className={`${s.body} italic text-foreground max-w-[260px] leading-relaxed`}
        >
          {body}
        </div>
      )}
      {cta && (
        <button
          type="button"
          onClick={cta.onClick}
          disabled={cta.disabled}
          className={`mt-1 flex items-center gap-1.5 rounded-card bg-gradient-to-b from-cyan-500/25 to-cyan-500/10 text-cyan-100 border border-cyan-500/40 font-semibold hover:from-cyan-500/35 hover:to-cyan-500/15 shadow-[0_0_12px_-4px_rgba(34,211,238,0.4)] disabled:opacity-50 disabled:cursor-not-allowed transition-all ${s.ctaBase}`}
        >
          {CtaIcon && <CtaIcon className={s.ctaIconCls} />}
          {cta.label}
        </button>
      )}
    </div>
  );
}
