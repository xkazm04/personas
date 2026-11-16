/**
 * lensSheetStore - which lens-scan sheet is open over the deck, if any
 * (spark one-control, WP3). A Build or Evidence card opens the blueprint at
 * its product; a Release card opens the release's read-only composition.
 *
 * One request at a time. Closing it re-reads the products, so the deck's
 * counts and cards follow whatever was decided on the sheet.
 */
import { create } from 'zustand';

import { refreshLensScanProducts } from '../roster/lensScanSource';
import type { FocusPlace } from '../blueprint/model/focus';
import type { LensKind } from './lensKinds';

export interface LensSheetRequest {
  kind: LensKind;
  projectId: string;
  /**
   * Where to open the drawing: a place bp's shared focus moved to (spark roadmap S6, the follower in bpFollower.ts).
   * The sheet is keyed by product, so a place on another product remounts it; it applies the place once its camera
   * exists.
   */
  place?: FocusPlace;
}

interface LensSheetState {
  request: LensSheetRequest | null;
}

export const useLensSheetStore = create<LensSheetState>(() => ({ request: null }));

export function openLensSheet(request: LensSheetRequest): void {
  useLensSheetStore.setState({ request });
}

export function closeLensSheet(): void {
  if (!useLensSheetStore.getState().request) return;
  useLensSheetStore.setState({ request: null });
  void refreshLensScanProducts();
}
