/**
 * frameLook — the stylistic direction of the four-edge chat.
 *
 * The interface floats over the app in four pieces (top: her latest words and
 * the mode keys, bottom: the input, left: the tools rail, right: the usage
 * panel). Structure is shared; what differs per look is the wrapper surface and
 * shape, where the pieces sit (detached vs edge-attached), the typography and
 * the icon treatment.
 *
 * Halo is the look the owner kept from round 2 (Glass and Bezel were removed):
 * floating cards, each wearing the workforce glow frame, accent headings,
 * duotone icons in tinted discs.
 */


export type FrameLookId = 'halo';

export interface FrameLook {
  id: FrameLookId;
  /** Surface classes of a piece (background, border, radius, shadow). */
  surface: { top: string; bottom: string; left: string; right: string; center: string };
  /** Where each piece sits in `VariantFrame`'s grid (never sized from 100vw). */
  place: { top: string; bottom: string; left: string; right: string; center: string };
  /** Wrap each piece in the workforce state frame (`.athena-frame`). */
  framed: boolean;
  icon: { button: string; active: string; stroke: number; size: string };
  message: string;
  label: string;
}

export const FRAME_LOOKS: Record<FrameLookId, FrameLook> = {
  halo: {
    id: 'halo',
    surface: {
      top: 'rounded-modal',
      bottom: 'rounded-modal',
      left: 'rounded-modal',
      right: 'rounded-modal',
      center: 'rounded-modal',
    },
    // Placement inside `VariantFrame`'s full-app grid, never from the viewport
    // width: top and bottom are capped and centred in the centre column, the
    // centre piece fills the column's middle cell, the rails size to content.
    // The top (her words) is a reading column: 736px, 20% under the 920px it
    // shipped at, so a reply sits on a comfortable measure; the input keeps
    // its old relation to it (about 0.87 of the top). The centre piece (Brain,
    // report reader) keeps 920px: it holds documents, not a chat line.
    place: {
      top: 'relative w-full max-w-[736px] mx-auto',
      bottom: 'relative w-full max-w-[640px] mx-auto',
      left: 'relative self-center max-h-full',
      right: 'relative h-full min-h-0',
      center: 'absolute inset-0 mx-auto w-full max-w-[920px]',
    },
    framed: true,
    icon: {
      button: 'w-9 h-9 rounded-full bg-primary/10 text-primary/85 hover:bg-primary/20 hover:text-primary',
      active: 'bg-primary text-background',
      stroke: 2,
      size: 'w-4 h-4',
    },
    message: 'typo-body-lg text-foreground',
    label: 'typo-label uppercase tracking-wider text-primary',
  },
};
