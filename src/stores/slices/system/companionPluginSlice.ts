import type { StateCreator } from 'zustand';
import type { SystemStore } from '../../storeTypes';

export type CompanionPluginTab = 'setup' | 'memory' | 'voice';

/**
 * Companion plugin state.
 *
 * Surfaces three settings that the plugin's Setup tab exposes:
 *   - `companionFooterEnabled` — show/hide the bot icon in DesktopFooter.
 *     False hides the icon entirely; the chat panel is then unreachable
 *     except via the plugin page itself (intentional — the plugin's
 *     reason to disable the footer is to declutter).
 *   - `companionSoundEnabled` — chime on completed reply.
 *   - Voice config (Phase later) — credential id + voice id + master enable.
 *     The Voice panel writes these once the user picks an ElevenLabs
 *     credential from the vault and types a voice id.
 *
 * All four toggles are persisted via systemStore's `partialize`.
 */
export interface CompanionPluginSlice {
  companionPluginTab: CompanionPluginTab;
  companionFooterEnabled: boolean;
  companionSoundEnabled: boolean;
  companionVoiceEnabled: boolean;
  companionVoiceCredentialId: string | null;
  companionVoiceId: string | null;

  setCompanionPluginTab: (tab: CompanionPluginTab) => void;
  setCompanionFooterEnabled: (v: boolean) => void;
  setCompanionSoundEnabled: (v: boolean) => void;
  setCompanionVoiceEnabled: (v: boolean) => void;
  setCompanionVoiceCredentialId: (id: string | null) => void;
  setCompanionVoiceId: (id: string | null) => void;
}

export const createCompanionPluginSlice: StateCreator<
  SystemStore,
  [],
  [],
  CompanionPluginSlice
> = (set) => ({
  companionPluginTab: 'setup',
  companionFooterEnabled: true,
  companionSoundEnabled: true,
  companionVoiceEnabled: false,
  companionVoiceCredentialId: null,
  companionVoiceId: null,

  setCompanionPluginTab: (companionPluginTab) => set({ companionPluginTab }),
  setCompanionFooterEnabled: (companionFooterEnabled) =>
    set({ companionFooterEnabled }),
  setCompanionSoundEnabled: (companionSoundEnabled) =>
    set({ companionSoundEnabled }),
  setCompanionVoiceEnabled: (companionVoiceEnabled) =>
    set({ companionVoiceEnabled }),
  setCompanionVoiceCredentialId: (companionVoiceCredentialId) =>
    set({ companionVoiceCredentialId }),
  setCompanionVoiceId: (companionVoiceId) => set({ companionVoiceId }),
});
