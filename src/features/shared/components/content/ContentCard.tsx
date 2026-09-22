import type { ReactNode } from 'react';
import { CONTENT_TONES, type ContentTone } from './contentTones';

interface ContentCardProps {
  tone?: ContentTone;
  /** A lucide icon element, sized by the card. */
  icon?: ReactNode;
  title?: ReactNode;
  /** Pills or badges beside the title. */
  badges?: ReactNode;
  /** Right-aligned header content: a timestamp, a count, an action. */
  trailing?: ReactNode;
  /**
   * `tinted` is the reviews/memories/knowledge card: a tone-coloured fill and
   * border with the header inline. `framed` is the message card: a neutral
   * surface whose header sits on its own strip above a divider.
   */
  variant?: 'tinted' | 'framed';
  children?: ReactNode;
  className?: string;
  'data-testid'?: string;
}

/**
 * @catalog ContentCard — the execution-detail content card, extracted: a tone-tinted (reviews, memories, insights) or framed (messages) card with an icon + semibold title header, pills beside the title, a trailing slot, and relaxed body prose. Use it for any record a reader studies rather than scans.
 *
 * Class strings are the ones `OutputSections` shipped, byte for byte where a
 * reader could see the difference, so a card built here and a card on the
 * execution detail cannot drift apart: the execution detail is built from
 * this component too.
 *
 * `rounded-xl`, NOT `rounded-card`: this repo re-points `--radius-xl` at 1rem
 * (16px) and `--radius-lg` at 0.75rem (12px), so `rounded-card` is 4px
 * tighter than the surface this was extracted from. Measured in a browser
 * against the original, not assumed from Tailwind's defaults. Keeping the
 * source class moves its existing radius lint warning here rather than adding
 * one.
 */
export function ContentCard({
  tone = 'primary',
  icon,
  title,
  badges,
  trailing,
  variant = 'tinted',
  children,
  className = '',
  'data-testid': testId,
}: ContentCardProps) {
  const t = CONTENT_TONES[tone];
  const hasHeader = !!(icon || title || badges || trailing);

  if (variant === 'framed') {
    return (
      <div
        className={`rounded-xl border border-primary/10 bg-secondary/10 overflow-hidden ${className}`}
        data-testid={testId}
      >
        {hasHeader && (
          <div className="px-4 py-3 border-b border-primary/8 flex items-center gap-2">
            {icon && <span className={`[&>svg]:w-4 [&>svg]:h-4 ${t.ink}`}>{icon}</span>}
            {title && <span className="typo-heading text-foreground/90">{title}</span>}
            {badges}
            {trailing && <span className="ml-auto">{trailing}</span>}
          </div>
        )}
        <div className="px-4 py-3">{children}</div>
      </div>
    );
  }

  return (
    <div
      className={`rounded-xl border ${t.border} ${t.fill} px-4 py-3.5 space-y-2 ${className}`}
      data-testid={testId}
    >
      {hasHeader && (
        <div className="flex items-center gap-2.5">
          {icon && <span className={`flex-shrink-0 [&>svg]:w-4 [&>svg]:h-4 ${t.ink}`}>{icon}</span>}
          {title && <span className="typo-heading text-foreground/85">{title}</span>}
          {badges}
          {trailing && <span className="ml-auto">{trailing}</span>}
        </div>
      )}
      {children}
    </div>
  );
}
