// THE MODAL INTERIOR STANDARD.
//
// `BaseModal` (src/lib/ui/BaseModal.tsx) owns everything OUTSIDE the panel -
// the portal, the overlay, focus handling, the placement and the animation -
// and it is used by 103 files. It owns nothing inside the panel, so every one
// of those callers hand-writes its own surface and its own header.
//
// MEASURED 2026-10-06 across those 103 consumers, which is what this component
// exists to answer:
//   - 40 DISTINCT `panelClassName` strings across 56 uses
//   - two radii: `rounded-2xl` at 42 sites against the `rounded-card` token at
//     9, so most modals bypass the radius token entirely
//   - three paddings in use (p-4, p-5, p-6)
//   - 13 distinct `maxWidthClass` values
// There is no modal standard in this app; there are forty of them. That is the
// "style is very inconsistent from Personas app" the owner reported, stated as
// a number.
//
// So this owns the inside: the surface, the header block and its type tiers, the
// scroll region, the section rhythm and the footer bar. A caller passes content
// and a SKIN, never a class string.
//
// @catalog ModalShell - the standard modal interior over BaseModal: surface,
// header (icon/title/subtitle/status/actions/close), scroll region, section
// rhythm and footer bar, in one of three skins. Use it instead of passing
// `panelClassName` to BaseModal.
import type { ReactNode } from 'react';
import { X } from 'lucide-react';

import { BaseModal } from '@/lib/ui/BaseModal';
import { Button } from '@/features/shared/components/buttons';
import { useTranslation } from '@/i18n/useTranslation';

import { SKINS, WIDTH, type ModalSkin, type ModalWidth } from './modalSkins';

export type { ModalSkin, ModalWidth } from './modalSkins';

export interface ModalShellProps {
  isOpen: boolean;
  onClose: () => void;
  titleId: string;
  skin?: ModalSkin;
  width?: ModalWidth;
  /** Leading glyph. Rendered in the skin's own chip. */
  icon?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  /** Badges / meta that sit under the title (status, percent, dates). */
  status?: ReactNode;
  /** Header-right controls. The close button is added after them. */
  actions?: ReactNode;
  /** Footer bar. Omitted entirely when absent - an empty bar is still a border. */
  footer?: ReactNode;
  children: ReactNode;
}

export function ModalShell({
  isOpen, onClose, titleId, skin = 'flat', width = 'md',
  icon, title, subtitle, status, actions, footer, children,
}: ModalShellProps) {
  const { t } = useTranslation();
  const k = SKINS[skin];
  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      titleId={titleId}
      maxWidthClass={WIDTH[width]}
      panelClassName={k.panel}
      staggerChildren={false}
    >
      <header className={`${k.header} flex items-start justify-between gap-3 shrink-0`}>
        <div className="flex items-start gap-3 min-w-0">
          {icon && (
            <span className={`${k.chip} flex items-center justify-center shrink-0`}>{icon}</span>
          )}
          <div className="min-w-0">
            <h2 id={titleId} className={k.title}>{title}</h2>
            {subtitle && <p className={`${k.subtitle} mt-0.5`}>{subtitle}</p>}
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
      <div className={`${k.body} min-h-0 flex-1`}>{children}</div>

      {footer && <div className={`${k.footer} shrink-0`}>{footer}</div>}
    </BaseModal>
  );
}

/**
 * A section inside a `ModalShell`, carrying the skin's rhythm and heading tier.
 * The skin decides whether that is a hairline rule (flat), an inset card
 * (raised) or pure whitespace (editorial) - the caller only says what the
 * section is.
 */
export function ModalSection({ skin = 'flat', label, actions, children }: {
  skin?: ModalSkin;
  label?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const k = SKINS[skin];
  return (
    <section className={k.section}>
      {(label || actions) && (
        <div className="flex items-center justify-between gap-2 mb-2">
          {label ? <h3 className={k.sectionHead}>{label}</h3> : <span />}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

/** The skin's section-heading class, for a block that draws its own head. */
export function modalSectionHeadClass(skin: ModalSkin): string {
  return SKINS[skin].sectionHead;
}
