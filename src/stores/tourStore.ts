/**
 * Standalone guided-tour store.
 *
 * Extracted out of the 18-slice `systemStore` (see docs ADR
 * "tour-slice-extraction"): systemStore is the hottest store in the app
 * (~1,181 subscription call sites across 336 files) and every write to it
 * re-evaluates every mounted selector across every one of its slices. The
 * guided tour is a self-contained, bursty-write concern — starting a tour,
 * advancing steps, tracking sub-steps and the spotlight highlight all fire
 * frequently while a tour is active — with no genuine cross-slice coupling
 * (`tourSlice.ts` never reads sibling systemStore state; it only reads its
 * own `get()`/`set()`). Moving it to its own store means tour writes stop
 * fanning out to every systemStore subscriber, and every non-tour systemStore
 * write stops re-running tour selectors.
 *
 * `tourSlice` manages its own persistence directly against `localStorage`
 * (see `loadPersistedState`/`persistState` in tourSlice.ts, key
 * `guided-tour-state`) rather than through Zustand's `persist` middleware, so
 * this store does not need (and never needed) to be wrapped in `persist` —
 * hydration already happens synchronously at slice construction time, same
 * as when it lived inside systemStore.
 */
import { create } from "zustand";
import { createTourSlice, type TourSlice } from "./slices/system/tourSlice";

export const useTourStore = create<TourSlice>()((...a) => ({
  ...createTourSlice(...a),
}));
