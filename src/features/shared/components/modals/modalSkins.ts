// The three styling approaches a `ModalShell` can wear, and the class table
// behind them.
//
// Split out of `ModalShell` 2026-10-06 to keep both files under the repo's
// 200-line ceiling. It is also the right seam: this file is pure DESIGN - every
// decision about surface, radius, elevation, type tier and rhythm lives here,
// and nothing in it renders. Adding a fourth skin is an entry in one table.
//
// Every value is a token. No literal radius, no literal shadow, no literal font
// size: the measurement that motivated the whole component found 42 modals using
// `rounded-2xl` instead of the radius token, and this is the file that makes that
// impossible to repeat by accident.

/**
 * The three styling approaches, over an identical layout.
 *
 * `flat`      the app's dominant look, made canonical: one hairline border, the
 *             radius TOKEN, a single flat surface, section heads as uppercase
 *             captions. Quietest, and the closest match to the rest of the app.
 * `raised`    layered surfaces: a tinted header band, content on inset panels,
 *             so each section reads as its own card. Larger title, looser
 *             rhythm. Closest to the Overview and Factory surfaces.
 * `editorial` typographic: almost no chrome, hierarchy carried by the type
 *             scale and whitespace alone, one rule under the title, body held
 *             to a reading measure. Closest to the docs surfaces.
 */
export type ModalSkin = 'flat' | 'raised' | 'editorial';

export type ModalWidth = 'sm' | 'md' | 'lg' | 'xl';

export const WIDTH: Record<ModalWidth, string> = {
  sm: 'max-w-[32rem]',
  md: 'max-w-[50rem]',
  lg: 'max-w-[72rem]',
  xl: 'max-w-[84rem]',
};

export interface SkinSpec {
  /** The panel itself. One radius token, one elevation token, no literals. */
  panel: string;
  /** The header band. */
  header: string;
  /** Title type tier. */
  title: string;
  /** Subtitle type tier. */
  subtitle: string;
  /** The body region. */
  body: string;
  /** A section's own wrapper, for `ModalSection`. */
  section: string;
  /** A section heading. */
  sectionHead: string;
  /** The footer bar. */
  footer: string;
  /** Icon chip beside the title. */
  chip: string;
}

export const SKINS: Record<ModalSkin, SkinSpec> = {
  flat: {
    panel: 'bg-background border border-primary/10 rounded-card shadow-elevation-4 flex flex-col max-h-[88vh]',
    header: 'px-6 pt-6 pb-4',
    title: 'typo-section-title',
    subtitle: 'typo-caption text-foreground',
    body: 'px-6 pb-6 overflow-y-auto',
    section: 'pt-3 mt-3 border-t border-primary/10 first:pt-0 first:mt-0 first:border-t-0',
    sectionHead: 'typo-caption uppercase tracking-[0.18em] text-foreground',
    footer: 'px-6 py-3 border-t border-primary/10 flex items-center justify-end gap-2',
    chip: 'w-10 h-10 rounded-interactive bg-primary/10 border border-primary/25 text-primary',
  },
  raised: {
    panel: 'bg-card border border-primary/15 rounded-card shadow-elevation-4 flex flex-col max-h-[88vh] overflow-hidden',
    header: 'px-6 pt-6 pb-4 bg-secondary/30 border-b border-primary/10',
    title: 'typo-title-lg',
    subtitle: 'typo-body text-foreground',
    body: 'px-6 py-5 overflow-y-auto space-y-4',
    section: 'rounded-card border border-primary/10 bg-background/60 px-4 py-3',
    sectionHead: 'typo-label text-foreground',
    footer: 'px-6 py-3 bg-secondary/30 border-t border-primary/10 flex items-center justify-end gap-2',
    chip: 'w-12 h-12 rounded-card bg-primary/15 border border-primary/30 text-primary',
  },
  editorial: {
    panel: 'bg-background border border-primary/[0.08] rounded-card shadow-elevation-3 flex flex-col max-h-[88vh]',
    header: 'px-8 pt-8 pb-5',
    title: 'typo-title-lg',
    subtitle: 'typo-body text-foreground max-w-[60ch]',
    body: 'px-8 pb-8 overflow-y-auto space-y-6',
    section: '',
    sectionHead: 'typo-overline text-foreground',
    footer: 'px-8 py-4 flex items-center justify-end gap-3',
    chip: 'w-9 h-9 rounded-pill bg-primary/10 text-primary',
  },
};
