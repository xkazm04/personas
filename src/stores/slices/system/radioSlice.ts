import type { StateCreator } from 'zustand';
import type { SystemStore } from '../../storeTypes';

/**
 * Radio plugin state.
 *
 * - `radioEnabled` — master switch. When false, `DesktopFooter` doesn't
 *   render the centre-cluster controller at all. Off by default — the
 *   radio is opt-in because not every user wants background music.
 * - `disabledStationIds` — per-station hide-from-picker list. Stations
 *   in this list don't appear in `StationPicker`. Stored as a list of
 *   ids (not a Set) so persistence round-trips cleanly through the
 *   systemStore JSON storage. New stations added to the curated catalog
 *   default to enabled (absent from the list).
 * - `radioAutoResume` — when on, the last-playing station auto-starts
 *   the first time `RadioFooter` mounts after app launch. Off by
 *   default; uninvited audio at startup is rude. Only fires if the
 *   master `radioEnabled` is on and the persisted radio state has a
 *   current station — otherwise the user opens the picker themselves.
 * - `collapsedSourceKinds` — which station-source groups are collapsed
 *   in `StationPicker`. Stored as a list of `'youtubeTracks' | 'stream'`
 *   values; absent means expanded. Persisted so collapse choice survives
 *   reopening the picker (and the app).
 *
 * All four fields are persisted via `systemStore`'s `partialize`, so
 * user choices survive restarts. The toggles live in Settings →
 * Account (`RadioSettingsCard`); the collapse state is set inline in
 * the picker.
 */
export type StationSourceKind = 'youtubeTracks' | 'stream';

export interface RadioSlice {
  radioEnabled: boolean;
  disabledStationIds: string[];
  radioAutoResume: boolean;
  collapsedSourceKinds: StationSourceKind[];
  setRadioEnabled: (radioEnabled: boolean) => void;
  setStationDisabled: (stationId: string, disabled: boolean) => void;
  setRadioAutoResume: (autoResume: boolean) => void;
  setSourceKindCollapsed: (kind: StationSourceKind, collapsed: boolean) => void;
}

export const createRadioSlice: StateCreator<SystemStore, [], [], RadioSlice> = (set) => ({
  radioEnabled: false,
  disabledStationIds: [],
  radioAutoResume: false,
  collapsedSourceKinds: [],
  setRadioEnabled: (radioEnabled) => set({ radioEnabled }),
  setStationDisabled: (stationId, disabled) =>
    set((state) => {
      const current = new Set(state.disabledStationIds);
      if (disabled) current.add(stationId);
      else current.delete(stationId);
      return { disabledStationIds: Array.from(current) };
    }),
  setRadioAutoResume: (autoResume) => set({ radioAutoResume: autoResume }),
  setSourceKindCollapsed: (kind, collapsed) =>
    set((state) => {
      const current = new Set(state.collapsedSourceKinds);
      if (collapsed) current.add(kind);
      else current.delete(kind);
      return { collapsedSourceKinds: Array.from(current) };
    }),
});
