/**
 * frameLook — the three stylistic directions of the four-edge chat.
 *
 * The interface floats over the app in four pieces (top: her latest words and
 * the mode keys, bottom: the input, left: the tools rail, right: the usage
 * panel). Structure is shared; what differs per look is the wrapper surface and
 * shape, where the pieces sit (detached vs edge-attached), the typography and
 * the icon treatment.
 *
 * - glass: detached frosted pills, airy type, thin-stroke icons in round ghosts.
 * - bezel: solid slabs welded to the window edges like an instrument bezel,
 *   mono labels, icons as square keycaps.
 * - halo:  floating cards, each wearing the workforce glow frame, bolder type,
 *   duotone icons in tinted discs.
 */

import type { ColumnsLook } from '../ProcessColumns';

export type FrameLookId = 'glass' | 'bezel' | 'halo';

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
  glass: {
    id: 'glass',
    surface: {
      top: 'rounded-[28px] bg-background/60 backdrop-blur-xl border border-foreground/12 shadow-elevation-3',
      bottom: 'rounded-full bg-background/60 backdrop-blur-xl border border-foreground/12 shadow-elevation-3',
      left: 'rounded-full bg-background/60 backdrop-blur-xl border border-foreground/12 shadow-elevation-3',
      right: 'rounded-[28px] bg-background/60 backdrop-blur-xl border border-foreground/12 shadow-elevation-3',
      center: 'rounded-[28px] bg-background/80 backdrop-blur-xl border border-foreground/12 shadow-elevation-4',
    },
    place: {
      top: `${TOP} left-1/2 -translate-x-1/2 w-[min(880px,calc(100vw-800px))]`,
      bottom: 'bottom-6 left-1/2 -translate-x-1/2 w-[min(760px,calc(100vw-800px))]',
      left: 'left-5 top-1/2 -translate-y-1/2',
      right: `right-5 ${TOP} bottom-6`,
      center: 'left-1/2 -translate-x-1/2 top-[396px] bottom-[104px] w-[min(860px,calc(100vw-800px))]',
    },
    framed: false,
    icon: {
      button: 'w-9 h-9 rounded-full text-foreground/75 hover:text-foreground hover:bg-foreground/[0.08]',
      active: 'bg-primary/20 text-primary',
      stroke: 1.5,
      size: 'w-[18px] h-[18px]',
    },
    message: 'typo-body-lg text-foreground/95',
    label: 'typo-caption text-foreground/70',
    columns: 'glass',
  },
  bezel: {
    id: 'bezel',
    surface: {
      top: 'rounded-b-card bg-secondary border-x border-b border-foreground/20 shadow-[inset_0_-2px_0_rgba(0,0,0,0.35),0_10px_30px_-12px_rgba(0,0,0,0.7)]',
      bottom: 'rounded-t-card bg-secondary border-x border-t border-foreground/20 shadow-[inset_0_2px_0_rgba(255,255,255,0.04),0_-10px_30px_-12px_rgba(0,0,0,0.7)]',
      left: 'rounded-r-card bg-secondary border-y border-r border-foreground/20 shadow-[inset_-2px_0_0_rgba(0,0,0,0.35)]',
      right: 'rounded-l-card bg-secondary border-y border-l border-foreground/20 shadow-[inset_2px_0_0_rgba(0,0,0,0.35)]',
      center: 'rounded-card bg-secondary border border-foreground/20 shadow-elevation-4',
    },
    place: {
      top: 'top-[92px] left-[64px] right-[380px]',
      bottom: 'bottom-0 left-[64px] right-[380px]',
      left: 'left-0 top-[92px] bottom-0',
      right: 'right-0 top-[92px] bottom-0 w-[372px]',
      center: 'left-[64px] right-[380px] top-[372px] bottom-[92px] mx-6',
    },
    framed: false,
    icon: {
      button: 'w-9 h-9 rounded-[4px] border border-foreground/20 bg-background text-foreground/80 shadow-[inset_0_-2px_0_rgba(0,0,0,0.4)] hover:text-foreground hover:border-foreground/35',
      active: 'border-primary/60 text-primary shadow-[inset_0_-2px_0_rgba(0,0,0,0.4),0_0_10px_-3px_var(--primary)]',
      stroke: 2,
      size: 'w-4 h-4',
    },
    message: 'typo-body-lg text-foreground',
    label: 'typo-caption font-mono uppercase tracking-wider text-foreground/65',
    columns: 'bezel',
  },
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
