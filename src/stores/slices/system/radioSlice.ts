import type { StateCreator } from 'zustand';
import type { SystemStore } from '../../storeTypes';

/**
 * Radio plugin state.
 *
 * `radioEnabled` controls whether the centre cluster of `DesktopFooter`
 * renders the radio controller. Off by default — the radio is opt-in
 * because not every user wants background music. Toggling lives in
 * Settings → Account (`RadioSettingsCard`); the choice is persisted
 * via `systemStore`'s `partialize` so it survives restarts.
 */
export interface RadioSlice {
  radioEnabled: boolean;
  setRadioEnabled: (radioEnabled: boolean) => void;
}

export const createRadioSlice: StateCreator<SystemStore, [], [], RadioSlice> = (set) => ({
  radioEnabled: false,
  setRadioEnabled: (radioEnabled) => set({ radioEnabled }),
});
