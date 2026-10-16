/**
 * What the reader is pointing at, in a store of its own so a hover re-renders
 * only what it changes: the header's readout line and the cells whose
 * outline flips (each cell subscribes to a boolean). The header itself never
 * changes shape on a hover (the owner's fixed-height rule).
 *
 * `cursor` is the keyboard twin: the item ↑/↓ walks in the lit column.
 */
import { create } from 'zustand';

export type LensPointer =
  | { kind: 'step'; stepId: string }
  | { kind: 'cell'; stepId: string; projectId: string }
  | { kind: 'change'; stepId: string; ref: string };

interface LensPointerState {
  hover: LensPointer | null;
  /** Index of the keyboard cursor inside the lit column's items, or -1. */
  cursor: number;
  setHover: (p: LensPointer | null) => void;
  setCursor: (i: number) => void;
}

export const useLensPointer = create<LensPointerState>((set) => ({
  hover: null,
  cursor: -1,
  setHover: (hover) => set({ hover }),
  setCursor: (cursor) => set({ cursor }),
}));

/** True when the pointer is on this project, anywhere: its cells outline in every column. */
export function useProjectHighlighted(projectId: string | undefined): boolean {
  return useLensPointer((s) => !!projectId && s.hover?.kind === 'cell' && s.hover.projectId === projectId);
}
