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

import type { ColumnsLook } from '../ProcessColumns';

export type FrameLookId = 'halo';

export interface FrameLook {
  id: FrameLookId;
  /** Surface classes of a piece (background, border, radius, shadow). */
  surface: { top: string; bottom: string; left: string; right: string; center: string };
  /** Where each piece sits in the viewport. */
  place: { top: string; bottom: string; left: string; right: string; center: string };
  /** Wrap each piece in the workforce state frame (`.athena-frame`). */
  framed: boolean;
  icon: { button: string; active: string; stroke: number; size: string };
  message: string;
  label: string;
  columns: ColumnsLook;
}

// Top edge sits under the title bar (48px) and the prototype switcher.
const TOP = 'top-[100px]';

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
    place: {
      top: `${TOP} left-1/2 -translate-x-1/2 w-[min(900px,calc(100vw-800px))]`,
      bottom: 'bottom-6 left-1/2 -translate-x-1/2 w-[min(780px,calc(100vw-800px))]',
      left: 'left-5 top-1/2 -translate-y-1/2',
      right: `right-5 ${TOP} bottom-6`,
      center: 'left-1/2 -translate-x-1/2 top-[400px] bottom-[104px] w-[min(880px,calc(100vw-800px))]',
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
    columns: 'halo',
  },
};
