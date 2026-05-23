import type { StateCreator } from 'zustand';
import type { SystemStore } from '../../storeTypes';

export type CompanionPluginTab =
  | 'setup'
  | 'memory'
  | 'voice'
  | 'dashboard'
  | 'decisions';

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
 * `UnifiedBuildEntry` reads it on mount, applies it, and clears it
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

/**
 * Allowlist of ElevenLabs models the Voice tab is permitted to write into
 * `companionVoiceModel`. Mirrored on the backend (`voice.rs::TTS_ALLOWED_MODELS`)
 * — keep them in lockstep when adding a new model.
 */
export const COMPANION_VOICE_MODELS = [
  'eleven_turbo_v2_5',
  'eleven_flash_v2_5',
  'eleven_multilingual_v2',
  'eleven_v3',
] as const;
export type CompanionVoiceModel = (typeof COMPANION_VOICE_MODELS)[number];

/**
 * TTS engine the user picked in the Voice tab. Mirrors `TtsEngineId` in
 * `src/api/companion.ts` and the Rust enum in `companion/tts/mod.rs`.
 *
 * Defaults to `'elevenlabs'` for back-compat with existing users — the
 * Piper engine requires a separate one-time install of the `piper`
 * binary, so we never quietly route users through it.
 */
export type CompanionTtsEngine = 'elevenlabs' | 'piper';

/**
 * Persisted floating-orb dock position, expressed as viewport fractions
 * (0..1) of the orb's top-left corner. `x` snaps to a side edge (≈0 left /
 * ≈1 right) when the user drops the orb; `y` is free (clamped to the
 * viewport). Resolved to pixels at render time so it survives window
 * resizes. Default sits bottom-right, just above the footer.
 */
export interface OrbPosition {
  x: number;
  y: number;
}

export interface CompanionPluginSlice {
  companionPluginTab: CompanionPluginTab;
  companionFooterEnabled: boolean;
  companionSoundEnabled: boolean;
  companionVoiceEnabled: boolean;
  /** Which engine handles synthesis. Per-engine voice selection lives in
   *  `companionVoiceCredentialId` + `companionVoiceId` (ElevenLabs) and
   *  `companionPiperVoiceId` (Piper). The send pipeline picks the right
   *  set based on this engine field. */
  companionVoiceEngine: CompanionTtsEngine;
  companionVoiceCredentialId: string | null;
  companionVoiceId: string | null;
  /** Currently-selected Piper voice id (e.g. `en_US-amy-medium`).
   *  Independent of `companionVoiceId` so switching engines doesn't
   *  clobber either side's last selection. */
  companionPiperVoiceId: string | null;
  /**
   * Per-call voice tuning. All five are nullable: `null` means "let the
   * backend apply its default". The Voice tab exposes these as a Settings
   * section; advanced users can also leave them at null to inherit
   * server-side defaults.
   */
  companionVoiceModel: CompanionVoiceModel | null;
  /** 0..1 — `null` falls back to backend default (0.5). */
  companionVoiceStability: number | null;
  /** 0..1 — `null` falls back to backend default (0.75). */
  companionVoiceSimilarity: number | null;
  /** 0.7..1.2 — `null` omits the field (ElevenLabs default speed). */
  companionVoiceSpeed: number | null;
  /** 0..1 — only meaningful on multilingual_v2 / v3. `null` omits. */
  companionVoiceStyle: number | null;
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
  /**
   * Master switch for Athena's floating dockable orb (the minimized
   * presence that lives as an overlay above app content). When off, the
   * footer button behaves as the classic open/collapse chat toggle.
   * Default on — the orb is the headline of the companion-overlay work.
   */
  companionOrbEnabled: boolean;
  /** Persisted orb dock position (viewport fractions). See {@link OrbPosition}. */
  companionOrbPos: OrbPosition;
  /**
   * Recall synthesis: when true, dense recall (above ~5K tokens) is
   * folded through a one-shot Claude call into a focused briefing
   * before reaching Athena's chat session. Adds runtime Claude-call
   * cost on qualifying turns; off-by-default. Below-threshold turns
   * skip synthesis cleanly even when this flag is true.
   */
  companionRecallSynthesisEnabled: boolean;
  /**
   * A2: when true, Athena may chain turns autonomously by emitting
   * `OP: continue_autonomously` — the backend schedules a follow-up
   * turn ~15s later. Toggle lives in the chat-panel header; any user
   * message cancels the pending continuation gracefully (the "stop"
   * UX is "type anything").
   */
  companionAutonomousMode: boolean;
  /**
   * Currently-typed intent in `UnifiedBuildEntry`, mirrored into the
   * slice so the Decisions panel can auto-scope its filter to the
   * persona the user is actively designing. Not persisted (session-
   * scoped UI affordance — surprising to resume "currently designing"
   * state across app restarts). Cleared on launch success and on
   * `UnifiedBuildEntry` re-mount with an empty initial intent.
   */
  activeBuildIntent: string | null;

  setCompanionPluginTab: (tab: CompanionPluginTab) => void;
  setCompanionFooterEnabled: (v: boolean) => void;
  setCompanionSoundEnabled: (v: boolean) => void;
  setCompanionVoiceEnabled: (v: boolean) => void;
  setCompanionVoiceEngine: (e: CompanionTtsEngine) => void;
  setCompanionVoiceCredentialId: (id: string | null) => void;
  setCompanionVoiceId: (id: string | null) => void;
  setCompanionPiperVoiceId: (id: string | null) => void;
  setCompanionVoiceModel: (m: CompanionVoiceModel | null) => void;
  setCompanionVoiceStability: (v: number | null) => void;
  setCompanionVoiceSimilarity: (v: number | null) => void;
  setCompanionVoiceSpeed: (v: number | null) => void;
  setCompanionVoiceStyle: (v: number | null) => void;
  /** Reset all 5 tuning fields back to `null` (server-default behaviour). */
  resetCompanionVoiceSettings: () => void;
  setCompanionPrefill: (p: CompanionPrefill | null) => void;
  setCompanionLabJump: (j: CompanionLabJump | null) => void;
  setCompanionPanelCompact: (v: boolean) => void;
  setCompanionOrbEnabled: (v: boolean) => void;
  setCompanionOrbPos: (p: OrbPosition) => void;
  setCompanionRecallSynthesisEnabled: (v: boolean) => void;
  setCompanionAutonomousMode: (v: boolean) => void;
  setActiveBuildIntent: (intent: string | null) => void;
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
  companionVoiceEngine: 'elevenlabs',
  companionVoiceCredentialId: null,
  companionVoiceId: null,
  companionPiperVoiceId: null,
  companionVoiceModel: null,
  companionVoiceStability: null,
  companionVoiceSimilarity: null,
  companionVoiceSpeed: null,
  companionVoiceStyle: null,
  companionPrefill: null,
  companionLabJump: null,
  companionPanelCompact: false,
  companionOrbEnabled: true,
  companionOrbPos: { x: 1, y: 0.82 },
  companionRecallSynthesisEnabled: false,
  companionAutonomousMode: false,
  activeBuildIntent: null,

  setCompanionPluginTab: (companionPluginTab) => set({ companionPluginTab }),
  setCompanionFooterEnabled: (companionFooterEnabled) =>
    set({ companionFooterEnabled }),
  setCompanionSoundEnabled: (companionSoundEnabled) =>
    set({ companionSoundEnabled }),
  setCompanionVoiceEnabled: (companionVoiceEnabled) =>
    set({ companionVoiceEnabled }),
  setCompanionVoiceEngine: (companionVoiceEngine) =>
    set({ companionVoiceEngine }),
  setCompanionVoiceCredentialId: (companionVoiceCredentialId) =>
    set({ companionVoiceCredentialId }),
  setCompanionVoiceId: (companionVoiceId) => set({ companionVoiceId }),
  setCompanionPiperVoiceId: (companionPiperVoiceId) =>
    set({ companionPiperVoiceId }),
  setCompanionVoiceModel: (companionVoiceModel) => set({ companionVoiceModel }),
  setCompanionVoiceStability: (companionVoiceStability) =>
    set({ companionVoiceStability }),
  setCompanionVoiceSimilarity: (companionVoiceSimilarity) =>
    set({ companionVoiceSimilarity }),
  setCompanionVoiceSpeed: (companionVoiceSpeed) => set({ companionVoiceSpeed }),
  setCompanionVoiceStyle: (companionVoiceStyle) => set({ companionVoiceStyle }),
  resetCompanionVoiceSettings: () =>
    set({
      companionVoiceModel: null,
      companionVoiceStability: null,
      companionVoiceSimilarity: null,
      companionVoiceSpeed: null,
      companionVoiceStyle: null,
    }),
  setCompanionPrefill: (companionPrefill) => set({ companionPrefill }),
  setCompanionLabJump: (companionLabJump) => set({ companionLabJump }),
  setCompanionPanelCompact: (companionPanelCompact) => set({ companionPanelCompact }),
  setCompanionOrbEnabled: (companionOrbEnabled) => set({ companionOrbEnabled }),
  setCompanionOrbPos: (companionOrbPos) => set({ companionOrbPos }),
  setCompanionRecallSynthesisEnabled: (companionRecallSynthesisEnabled) =>
    set({ companionRecallSynthesisEnabled }),
  setCompanionAutonomousMode: (companionAutonomousMode) =>
    set({ companionAutonomousMode }),
  setActiveBuildIntent: (activeBuildIntent) => set({ activeBuildIntent }),
});
