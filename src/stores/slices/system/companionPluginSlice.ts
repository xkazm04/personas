import type { StateCreator } from 'zustand';
import type { SystemStore } from '../../storeTypes';

export type CompanionPluginTab = 'setup' | 'memory' | 'voice' | 'dashboard';

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
/**
 * Phase F prefill payload — Athena's `prefill_persona_create` op
 * stashes a tuple here, then triggers navigation to `personas`.
 * `UnifiedMatrixEntry` reads it on mount, applies it, and clears it
 * via `clearCompanionPrefill()` so it's a one-shot bridge.
 *
 * Not persisted (intentionally — leaving a prefill in localStorage
 * would re-prefill on every cold start, which is surprising). The
 * trade-off: a refresh between Athena's approval click and the
 * personas page mount loses the prefill. Acceptable for v1.
 */
export interface CompanionPrefill {
  intent: string;
  name: string | null;
  autoLaunch: boolean;
  /**
   * Build mode when `autoLaunch` is true: `"interactive"` (default — the
   * questionnaire surface) or `"one_shot"` (autonomous build, read-only
   * Glyph view, terminal notification when done).
   */
  mode?: 'interactive' | 'one_shot';
  /**
   * Companion chat session that initiated this build. Threaded into
   * `start_build_session` so the BuildWatcher job can post the result
   * message into that chat's episode log on terminal phase.
   */
  companionSessionId?: string | null;
}

/**
 * Phase F lab-jump payload — Athena's `open_lab` op stashes
 * `(personaId, mode)` here. The persona editor reads this on mount
 * (or on the next render after navigation) and switches its tab to
 * `lab` + selects the requested mode. Cleared on consume.
 */
export interface CompanionLabJump {
  personaId: string;
  mode: string;
}

export interface CompanionPluginSlice {
  companionPluginTab: CompanionPluginTab;
  companionFooterEnabled: boolean;
  companionSoundEnabled: boolean;
  companionVoiceEnabled: boolean;
  companionVoiceCredentialId: string | null;
  companionVoiceId: string | null;
  /** Phase F: pending prefill from Athena's prefill_persona_create op. */
  companionPrefill: CompanionPrefill | null;
  /** Phase F: pending lab-jump from Athena's open_lab op. */
  companionLabJump: CompanionLabJump | null;
  /**
   * Phase F: when true, the chat panel renders at half width (~380px)
   * instead of the default 760px. Lets the user see the app behind the
   * chat without closing it. Persisted so the preference sticks.
   */
  companionPanelCompact: boolean;

  setCompanionPluginTab: (tab: CompanionPluginTab) => void;
  setCompanionFooterEnabled: (v: boolean) => void;
  setCompanionSoundEnabled: (v: boolean) => void;
  setCompanionVoiceEnabled: (v: boolean) => void;
  setCompanionVoiceCredentialId: (id: string | null) => void;
  setCompanionVoiceId: (id: string | null) => void;
  setCompanionPrefill: (p: CompanionPrefill | null) => void;
  setCompanionLabJump: (j: CompanionLabJump | null) => void;
  setCompanionPanelCompact: (v: boolean) => void;
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
  companionPrefill: null,
  companionLabJump: null,
  companionPanelCompact: false,

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
  setCompanionPrefill: (companionPrefill) => set({ companionPrefill }),
  setCompanionLabJump: (companionLabJump) => set({ companionLabJump }),
  setCompanionPanelCompact: (companionPanelCompact) => set({ companionPanelCompact }),
});
