import type { StateCreator } from 'zustand';
import type { SystemStore } from '../../storeTypes';
import type { FleetBoldnessLevel } from '@/api/companion';

export type CompanionPluginTab =
  | 'setup'
  | 'memory'
  | 'voice'
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
 *   - Voice config — engine + per-engine voice id + master enable,
 *     written by the Voice tab.
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
 * TTS engine the user picked in the Voice tab. Mirrors `TtsEngineId` in
 * `src/api/companion.ts` and the Rust enum in `companion/tts/mod.rs`.
 *
 * `'kokoro'` (primary — curated local voices) or `'pocket_tts'`
 * (experimental — zero-shot voice cloning). The ElevenLabs and Piper
 * engines were descoped 2026-07-10; use `normalizeCompanionTtsEngine`
 * wherever a persisted value may predate the descope.
 */
export type CompanionTtsEngine = 'kokoro' | 'pocket_tts';

/**
 * Map any persisted engine value (including the descoped `'elevenlabs'` /
 * `'piper'` strings still sitting in older localStorage) onto a live
 * engine. Unknown -> Kokoro, matching the backend's default.
 */
export function normalizeCompanionTtsEngine(
  v: string | null | undefined,
): CompanionTtsEngine {
  return v === 'pocket_tts' ? 'pocket_tts' : 'kokoro';
}

/**
 * STT engine for Athena's voice input. Mirrors `SttEngineId` in
 * `src/api/companion.ts`.
 *
 * Defaults to `'browser'` (Web Speech) for zero-setup back-compat; the
 * user opts into `'whisper'` (local, on-device) once they've installed the
 * engine binary + downloaded a model from the Voice tab.
 */
export type CompanionSttEngine = 'browser' | 'whisper';

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
   *  `companionKokoroVoiceId` / `companionPocketVoiceId`; the send
   *  pipeline picks the right one based on this engine field. */
  companionVoiceEngine: CompanionTtsEngine;
  /** Currently-selected Kokoro voice id (e.g. `af_heart`). Independent of
   *  the Pocket selection so switching engines doesn't clobber either
   *  side's last pick. */
  companionKokoroVoiceId: string | null;
  /** Currently-selected Pocket TTS voice id — a cloned `.safetensors`
   *  embedding name (e.g. `step4`) or a built-in Kyutai voice (e.g. `alba`).
   *  Independent of the other engines' selections. */
  companionPocketVoiceId: string | null;
  /** Speech rate 0.7..1.2 — `null` inherits the engine default. */
  companionVoiceSpeed: number | null;
  /**
   * Playback volume (0..1) applied to every TTS `<audio>` element, live —
   * `voicePlayback.play()` subscribes so a change affects Athena mid-sentence.
   * Distinct from the engine tuning above — this is client-side output level,
   * not a synthesis parameter. Default 0.5.
   */
  companionVoiceVolume: number;
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
  /** STT engine for voice input (footer hold-to-talk + orb). */
  companionSttEngine: CompanionSttEngine;
  /** Selected local whisper model id (e.g. `base.en`). Null until chosen. */
  companionSttModelId: string | null;
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
   * Fleet-orchestration BOLDNESS dial (Phase 2) — how aggressively Athena
   * auto-fires a `fleet_send_input` into a live CLI vs. surfacing it as an orb
   * consult, combined with her per-decision `decision_class` + `confidence`.
   * Only meaningful when autonomous mode is on. Mirrored server-side via
   * `companion_set_fleet_boldness`; the autoapprove gate reads it.
   */
  companionFleetBoldness: FleetBoldnessLevel;
  /**
   * DEV MODE — Athena's self-development loop (debug builds only). When
   * true, her prompt gains the self-model addendum (this repo is the
   * app's own source; feature-talk resolves to code via the context map)
   * and she may propose `dev_improve` dispatches. Toggle is the wrench
   * in the chat-panel header, rendered only when the backend reports
   * `devModeAvailable` (debug build). Mirrored server-side via
   * `companion_set_dev_mode` for the prompt assembler + executor.
   */
  companionDevMode: boolean;
  /**
   * P3 hands-free decision layer: when true, the decision queue
   * (`decision/useDecisionQueue`) aggregates pending approvals / human
   * reviews / blocking incidents and auto-surfaces them one-at-a-time in the
   * orb decision bubble. Off by default so the hands-free surface never
   * appears unless the user opts in; when off the queue does nothing (the
   * bubble can still be driven manually / by tests).
   */
  companionHandsFreeDecisions: boolean;
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
  setCompanionKokoroVoiceId: (id: string | null) => void;
  setCompanionPocketVoiceId: (id: string | null) => void;
  setCompanionVoiceSpeed: (v: number | null) => void;
  setCompanionVoiceVolume: (v: number) => void;
  setCompanionPrefill: (p: CompanionPrefill | null) => void;
  setCompanionLabJump: (j: CompanionLabJump | null) => void;
  setCompanionPanelCompact: (v: boolean) => void;
  setCompanionOrbEnabled: (v: boolean) => void;
  setCompanionOrbPos: (p: OrbPosition) => void;
  setCompanionSttEngine: (e: CompanionSttEngine) => void;
  setCompanionSttModelId: (id: string | null) => void;
  setCompanionRecallSynthesisEnabled: (v: boolean) => void;
  setCompanionAutonomousMode: (v: boolean) => void;
  setCompanionFleetBoldness: (v: FleetBoldnessLevel) => void;
  setCompanionDevMode: (v: boolean) => void;
  setCompanionHandsFreeDecisions: (v: boolean) => void;
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
  companionVoiceEngine: 'kokoro',
  companionKokoroVoiceId: null,
  companionPocketVoiceId: null,
  companionVoiceSpeed: null,
  companionVoiceVolume: 0.5,
  companionPrefill: null,
  companionLabJump: null,
  companionPanelCompact: false,
  companionOrbEnabled: true,
  companionOrbPos: { x: 1, y: 0.82 },
  companionSttEngine: 'browser',
  companionSttModelId: null,
  companionRecallSynthesisEnabled: false,
  companionAutonomousMode: false,
  companionFleetBoldness: 'bold',
  companionDevMode: false,
  companionHandsFreeDecisions: false,
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
  setCompanionKokoroVoiceId: (companionKokoroVoiceId) =>
    set({ companionKokoroVoiceId }),
  setCompanionPocketVoiceId: (companionPocketVoiceId) =>
    set({ companionPocketVoiceId }),
  setCompanionVoiceSpeed: (companionVoiceSpeed) => set({ companionVoiceSpeed }),
  setCompanionVoiceVolume: (companionVoiceVolume) => set({ companionVoiceVolume }),
  setCompanionPrefill: (companionPrefill) => set({ companionPrefill }),
  setCompanionLabJump: (companionLabJump) => set({ companionLabJump }),
  setCompanionPanelCompact: (companionPanelCompact) => set({ companionPanelCompact }),
  setCompanionOrbEnabled: (companionOrbEnabled) => set({ companionOrbEnabled }),
  setCompanionOrbPos: (companionOrbPos) => set({ companionOrbPos }),
  setCompanionSttEngine: (companionSttEngine) => set({ companionSttEngine }),
  setCompanionSttModelId: (companionSttModelId) => set({ companionSttModelId }),
  setCompanionRecallSynthesisEnabled: (companionRecallSynthesisEnabled) =>
    set({ companionRecallSynthesisEnabled }),
  setCompanionAutonomousMode: (companionAutonomousMode) =>
    set({ companionAutonomousMode }),
  setCompanionFleetBoldness: (companionFleetBoldness) =>
    set({ companionFleetBoldness }),
  setCompanionDevMode: (companionDevMode) => set({ companionDevMode }),
  setCompanionHandsFreeDecisions: (companionHandsFreeDecisions) =>
    set({ companionHandsFreeDecisions }),
  setActiveBuildIntent: (activeBuildIntent) => set({ activeBuildIntent }),
});
