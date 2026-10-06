// THE MODAL INTERIOR STANDARD.
//
// `BaseModal` (src/lib/ui/BaseModal.tsx) owns everything OUTSIDE the panel - the
// portal, the overlay, focus handling, the placement and the animation - and it
// is used by 103 files. It owned nothing inside the panel, so every one of those
// callers hand-wrote its own surface and its own header.
//
// MEASURED 2026-10-06 across those 103 consumers, which is what this exists to
// answer:
//   - 40 DISTINCT `panelClassName` strings across 56 uses
//   - two radii: `rounded-2xl` at 42 sites against the `rounded-card` token at
//     9, so most modals bypassed the radius token entirely
//   - three paddings in use (p-4, p-5, p-6)
//   - 13 distinct `maxWidthClass` values
// There was no modal standard in this app; there were forty.
//
// ONE INTERIOR, NOT THREE (2026-10-06, second pass). This shipped with three
// skins - flat / raised / editorial - as a contest for the goal drawer. RAISED
// won, and the other two are gone, because a standard with three variants is not
// a standard: it is the same inconsistency with a smaller number. The look below
// IS the app's modal look now.
//
// The winning interior: a `bg-card` panel on the radius token, a tinted header
// band separated by a hairline, content on inset panels so each section reads as
// its own card, one scroll region, and a footer bar on the same tinted surface
// as the header so the panel is visibly bracketed.
//
// Every value is a token. No literal radius, no literal shadow, no literal font
// size - the measurement above found 42 modals using `rounded-2xl` instead of
// the radius token, and this file is what makes that hard to repeat by accident.
//
// @catalog ModalShell - the standard modal interior over BaseModal: surface,
// header (icon/title/subtitle/status/actions/close), one scroll region, section
// rhythm via ModalSection, and footer bar. Use it instead of passing
// `panelClassName` to BaseModal.
import type { ReactNode } from 'react';
import { X } from 'lucide-react';

import { BaseModal } from '@/lib/ui/BaseModal';
import { Button } from '@/features/shared/components/buttons';
import { useTranslation } from '@/i18n/useTranslation';

export type ModalWidth = 'sm' | 'md' | 'lg' | 'xl';

const WIDTH: Record<ModalWidth, string> = {
  sm: 'max-w-[32rem]',
  md: 'max-w-[50rem]',
  lg: 'max-w-[72rem]',
  xl: 'max-w-[84rem]',
};

/**
 * THE section-heading class, and the reason this constant exists rather than a
 * string at each site.
 *
 * `typo-eyebrow` is the repo's canonical "tracked uppercase head of a section
 * inside a surface". Its own definition in typography.css says it was added at
 * Gate 0 precisely so a module can adopt ONE class where it otherwise composes
 * `typo-* uppercase tracking-*` by hand - and it counted 361 such hand-composed
 * strings when it was written.
 *
 * The goal drawer was five of them. Measured 2026-10-06 inside that ONE modal:
 * `typo-label`, `typo-caption uppercase tracking-[0.18em]`, `typo-caption
 * uppercase tracking-[0.16em]` (0.02em different from its neighbour for no
 * reason), and `typo-overline` - which is not defined by any stylesheet at all,
 * so that skin's section heads rendered as inherited type. The owner's report
 * that "each has different font and size" was exactly right.
 */
export const MODAL_SECTION_HEAD = 'typo-eyebrow text-foreground';

const PANEL = 'bg-card border border-primary/15 rounded-card shadow-elevation-4 flex flex-col max-h-[88vh] overflow-hidden';
const HEADER = 'px-6 pt-6 pb-4 bg-secondary/30 border-b border-primary/10';
const BODY = 'px-6 py-5 overflow-y-auto space-y-4';
const FOOTER = 'px-6 py-3 bg-secondary/30 border-t border-primary/10 flex items-center justify-end gap-2';

export interface ModalShellProps {
  isOpen: boolean;
  onClose: () => void;
  titleId: string;
  width?: ModalWidth;
  /** Leading glyph, rendered in the standard chip. */
  icon?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  /** Badges / meta under the title (status, percent, dates). */
  status?: ReactNode;
  /** Header-right controls. The close button is added after them. */
  actions?: ReactNode;
  /** Footer bar. Omitted entirely when absent - an empty bar is still a border. */
  footer?: ReactNode;
  children: ReactNode;
}

export function ModalShell({
  isOpen, onClose, titleId, width = 'md',
  icon, title, subtitle, status, actions, footer, children,
}: ModalShellProps) {
  const { t } = useTranslation();
  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      titleId={titleId}
      maxWidthClass={WIDTH[width]}
      panelClassName={PANEL}
      staggerChildren={false}
    >
      <header className={`${HEADER} flex items-start justify-between gap-3 shrink-0`}>
        <div className="flex items-start gap-3 min-w-0">
          {icon && (
            <span className="w-12 h-12 rounded-card bg-primary/15 border border-primary/30 text-primary flex items-center justify-center shrink-0">
              {icon}
            </span>
          )}
          <div className="min-w-0">
            <h2 id={titleId} className="typo-title-lg">{title}</h2>
            {subtitle && <p className="typo-body text-foreground mt-0.5">{subtitle}</p>}
            {status && <div className="flex items-center gap-2 mt-1.5 flex-wrap">{status}</div>}
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {actions}
          <Button variant="ghost" size="icon-sm" aria-label={t.common.close} onClick={onClose}>
            <X className="w-4 h-4" />
          </Button>
        </div>
      </header>

      {/* The one scroll region. Callers used to each decide whether the panel or
          the body scrolled, which is why a modal's header sometimes scrolled
          away and sometimes did not. */}
      <div className={`${BODY} min-h-0 flex-1`}>{children}</div>

      {footer && <div className={`${FOOTER} shrink-0`}>{footer}</div>}
    </BaseModal>
  );
}

/**
 * A section inside a `ModalShell`: an inset panel carrying the standard rhythm
 * and the one section-heading token. The caller says what the section IS; it
 * does not get to pick a different label font.
 */
export function ModalSection({ label, actions, children }: {
  label?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-card border border-primary/10 bg-background/60 px-4 py-3">
      {(label || actions) && (
        <div className="flex items-center justify-between gap-2 mb-2">
          {label ? <h3 className={MODAL_SECTION_HEAD}>{label}</h3> : <span />}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}
