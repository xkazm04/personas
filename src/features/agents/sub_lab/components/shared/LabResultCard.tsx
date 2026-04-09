import type { ReactNode } from 'react';
import { CARD_PADDING, BORDER_DEFAULT } from '@/lib/utils/designTokens';

/* ------------------------------------------------------------------ */
/*  LabResultCard — shared card shell for lab results views            */
/*  Unifies rounded-card + BORDER_DEFAULT + overflow-hidden across     */
/*  Ab, Arena, and Matrix result cards.                                */
/* ------------------------------------------------------------------ */

interface LabResultCardProps {
  children: ReactNode;
  /** Extra classes on the outer container (e.g. shadow, bg override) */
  className?: string;
  /** Override the default border class for special states (winner highlight, accent) */
  borderClass?: string;
}

/**
 * Outer card shell. Provides rounded corners, consistent border, and overflow clipping.
 * Compose with `LabResultCardHeader` and `LabResultCardBody` for split-zone layouts,
 * or pass children directly for single-zone cards.
 */
export function LabResultCard({ children, className, borderClass }: LabResultCardProps) {
  return (
    <div className={`rounded-card border ${borderClass ?? BORDER_DEFAULT} overflow-hidden ${className ?? ''}`}>
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Header sub-component                                               */
/* ------------------------------------------------------------------ */

interface LabResultCardHeaderProps {
  children?: ReactNode;
  className?: string;
  /** Icon element rendered before the title */
  icon?: ReactNode;
  /** Title text — rendered with typo-heading */
  title?: string;
  /** Subtitle below the title */
  subtitle?: string;
  /** Right-aligned slot (badges, actions) */
  trailing?: ReactNode;
}

/**
 * Optional header zone with CARD_PADDING.standard and a typo-heading title slot.
 */
export function LabResultCardHeader({ children, className, icon, title, subtitle, trailing }: LabResultCardHeaderProps) {
  const hasTitleRow = icon || title || trailing;
  return (
    <div className={`${CARD_PADDING.standard} ${className ?? ''}`}>
      {hasTitleRow && (
        <div className="flex items-center gap-2">
          {icon}
          <div className="flex-1 min-w-0">
            {title && <h4 className="typo-heading text-foreground">{title}</h4>}
            {subtitle && <p className="typo-caption text-foreground">{subtitle}</p>}
          </div>
          {trailing}
        </div>
      )}
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Body sub-component                                                 */
/* ------------------------------------------------------------------ */

interface LabResultCardBodyProps {
  children: ReactNode;
  className?: string;
}

/**
 * Body zone with CARD_PADDING.standard.
 */
export function LabResultCardBody({ children, className }: LabResultCardBodyProps) {
  return (
    <div className={`${CARD_PADDING.standard} ${className ?? ''}`}>
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Section header bar sub-component                                   */
/* ------------------------------------------------------------------ */

interface LabResultCardSectionHeaderProps {
  children: ReactNode;
  className?: string;
}

/**
 * Compact section header bar — used for insight/suggestion card headers
 * with a bottom border divider. Uses compact padding.
 */
export function LabResultCardSectionHeader({ children, className }: LabResultCardSectionHeaderProps) {
  return (
    <div className={`${CARD_PADDING.compact} border-b border-primary/5 ${className ?? ''}`}>
      {children}
    </div>
  );
}
