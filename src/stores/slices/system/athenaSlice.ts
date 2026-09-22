import type { StateCreator } from 'zustand';
import type { SystemStore } from '../../storeTypes';
import type { FleetBoldnessLevel } from '@/api/companion';
import type { CreateAthenaStepId } from '@/features/companions/athena/sub_create/engine/createAthenaTypes';
import {
  DEFAULT_EXPANDED_KINDS,
  type AttentionKind,
} from '@/features/companions/athena/attention/attentionKinds';

export type CompanionPluginTab =
  | 'create-athena'
  | 'setup'
  | 'memory'
  | 'voice'
  | 'decisions';

/**
 * Every persisted field this slice renamed when "Companion" stopped meaning
 * Athena and started meaning the category she belongs to. The map is the
 * migration: an install that predates the rename has a `persona-ui-system`
 * blob full of the left-hand names, and without it every one of these
 * settings silently reverts to its default on the first launch after the
 * upgrade.
 *
 * `companionPluginTab` is deliberately absent — the Companions navigation
 * change retires that field into a page field, so it is migrated once, there,
 * rather than twice.
 */
export const LEGACY_ATHENA_FIELDS: Readonly<Record<string, string>> = Object.freeze({
  companionFooterEnabled: 'athenaFooterEnabled',
  companionPanelCompact: 'athenaPanelCompact',
  companionSidePanelSlot: 'athenaSidePanelSlot',
  companionOrbEnabled: 'athenaOrbEnabled',
  companionOrbPos: 'athenaOrbPos',
  companionSttEngine: 'athenaSttEngine',
  companionSttModelId: 'athenaSttModelId',
  companionGlobalHotkeyEnabled: 'athenaGlobalHotkeyEnabled',
  companionSoundEnabled: 'athenaSoundEnabled',
  companionVoiceEnabled: 'athenaVoiceEnabled',
  companionVoiceEngine: 'athenaVoiceEngine',
  companionKokoroVoiceId: 'athenaKokoroVoiceId',
  companionPocketVoiceId: 'athenaPocketVoiceId',
  companionVoiceSpeed: 'athenaVoiceSpeed',
  companionVoiceVolume: 'athenaVoiceVolume',
  companionRecallSynthesisEnabled: 'athenaRecallSynthesisEnabled',
  companionAutonomousMode: 'athenaAutonomousMode',
  companionDevMode: 'athenaDevMode',
  companionHandsFreeDecisions: 'athenaHandsFreeDecisions',
  companionAlertsExpanded: 'athenaAlertsExpanded',
});

/**
 * Rewrite a persisted `persona-ui-system` blob's legacy `companion*` keys onto
 * their `athena*` successors, in the persist middleware's `merge` step so the
 * value lands before any consumer reads it.
 *
 * INVARIANT for the cast: the argument came back through `JSON.parse` from a
 * blob an OLDER BUILD wrote, so its real type is `unknown` and no declared
 * shape constrains it — it is read as a bag of keys and never trusted for
 * anything but a rename. A blob that already carries the new name keeps it
 * (a rollback-then-forward install writes both).
 */
export function remapLegacyAthenaFields(persisted: unknown): Record<string, unknown> {
  if (!persisted || typeof persisted !== 'object') return {};
  const blob: Record<string, unknown> = { ...(persisted as Record<string, unknown>) };
  for (const [legacy, next] of Object.entries(LEGACY_ATHENA_FIELDS)) {
    if (!(legacy in blob)) continue;
    if (!(next in blob)) blob[next] = blob[legacy];
    delete blob[legacy];
  }
  return blob;
}

/**
 * Athena's UI state.
 *
 * Surfaces three settings that her Setup tab exposes:
 *   - `athenaFooterEnabled` — show/hide the bot icon in DesktopFooter.
 *     False hides the icon entirely; the chat panel is then unreachable
 *     except via the plugin page itself (intentional — the plugin's
 *     reason to disable the footer is to declutter).
 *   - `athenaSoundEnabled` — chime on completed reply.
 *   - Voice config — engine + per-engine voice id + master enable,
 *     written by the Voice tab.
 *
 * All four toggles are persisted via systemStore's `partialize`.
 */
/**
 * Phase F prefill payload — Athena's `prefill_persona_create` op
 * stashes a tuple here, then triggers navigation to `personas`.
 * `UnifiedBuildEntry` reads it on mount, applies it, and clears it
 * via `clearAthenaPrefill()` so it's a one-shot bridge.
 *
 * Not persisted (intentionally — leaving a prefill in localStorage
 * would re-prefill on every cold start, which is surprising). The
 * trade-off: a refresh between Athena's approval click and the
 * personas page mount loses the prefill. Acceptable for v1.
 */
export interface AthenaPrefill {
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
export interface AthenaLabJump {
  personaId: string;
  mode: string;
}

/**
 * TTS engine the user picked in the Voice tab. Mirrors `TtsEngineId` in
 * `src/api/companion.ts` and the Rust enum in `companion/tts/mod.rs`.
 *
 * `'kokoro'` (primary — curated local voices) or `'pocket_tts'`
 * (experimental — zero-shot voice cloning). The ElevenLabs and Piper
 * engines were descoped 2026-07-10; use `normalizeAthenaTtsEngine`
 * wherever a persisted value may predate the descope.
 */
export type AthenaTtsEngine = 'kokoro' | 'pocket_tts';

/**
 * Map any persisted engine value (including the descoped `'elevenlabs'` /
 * `'piper'` strings still sitting in older localStorage) onto a live
 * engine. Unknown -> Kokoro, matching the backend's default.
 */
export function normalizeAthenaTtsEngine(
  v: string | null | undefined,
): AthenaTtsEngine {
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
export type AthenaSttEngine = 'browser' | 'whisper';

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

export interface AthenaSlice {
  companionPluginTab: CompanionPluginTab;
  athenaFooterEnabled: boolean;
  athenaSoundEnabled: boolean;
  athenaVoiceEnabled: boolean;
  /** Which engine handles synthesis. Per-engine voice selection lives in
   *  `athenaKokoroVoiceId` / `athenaPocketVoiceId`; the send
   *  pipeline picks the right one based on this engine field. */
  athenaVoiceEngine: AthenaTtsEngine;
  /** Currently-selected Kokoro voice id (e.g. `af_heart`). Independent of
   *  the Pocket selection so switching engines doesn't clobber either
   *  side's last pick. */
  athenaKokoroVoiceId: string | null;
  /** Currently-selected Pocket TTS voice id — a cloned `.safetensors`
   *  embedding name (e.g. `step4`) or a built-in Kyutai voice (e.g. `alba`).
   *  Independent of the other engines' selections. */
  athenaPocketVoiceId: string | null;
  /** Speech rate 0.7..1.2 — `null` inherits the engine default. */
  athenaVoiceSpeed: number | null;
  /**
   * Playback volume (0..1) applied to every TTS `<audio>` element, live —
   * `voicePlayback.play()` subscribes so a change affects Athena mid-sentence.
   * Distinct from the engine tuning above — this is client-side output level,
   * not a synthesis parameter. Default 0.5.
   */
  athenaVoiceVolume: number;
  /** Phase F: pending prefill from Athena's prefill_persona_create op. */
  athenaPrefill: AthenaPrefill | null;
  /** Phase F: pending lab-jump from Athena's open_lab op. */
  athenaLabJump: AthenaLabJump | null;
  /**
   * Phase F: when true, the chat panel renders at half width (~380px)
   * instead of the default 760px. Lets the user see the app behind the
   * chat without closing it. Persisted so the preference sticks.
   */
  athenaPanelCompact: boolean;
  /**
   * Inner side-panel slot (sits left of `AthenaToolbar`, right of the
   * chat column) — a reusable dock for glanceable feature surfaces inside
   * the chat window. `'fleet'` renders live Fleet stats; `null` collapses
   * the slot to a slim rail. Only fleet is registered today, but the shell
   * (`AthenaSidePanel`) is generic so a future feature can add its own
   * slot id without touching the layout plumbing. Persisted so the user's
   * open/collapsed choice survives a panel reopen.
   */
  athenaSidePanelSlot: 'fleet' | null;
  /**
   * Master switch for Athena's floating dockable orb (the minimized
   * presence that lives as an overlay above app content). When off, the
   * footer button behaves as the classic open/collapse chat toggle.
   * Default on — the orb is the headline of the companion-overlay work.
   */
  athenaOrbEnabled: boolean;
  /** Persisted orb dock position (viewport fractions). See {@link OrbPosition}. */
  athenaOrbPos: OrbPosition;
  /** STT engine for voice input (footer hold-to-talk + orb). */
  athenaSttEngine: AthenaSttEngine;
  /** Selected local whisper model id (e.g. `base.en`). Null until chosen. */
  athenaSttModelId: string | null;
  /**
   * When true, Athena's push-to-talk chord is also registered as an OS-level
   * accelerator, so voice works while the user is focused in another
   * application. The chord itself is fixed to the same Cmd/Ctrl+Shift+A the
   * in-app handler in `AthenaOrbLayer` already uses — one chord, two scopes.
   *
   * Off by default, deliberately: claiming a system-wide chord can take it
   * away from whatever app the user was already using it in, so it is opt-in
   * rather than something that silently happens on upgrade.
   */
  athenaGlobalHotkeyEnabled: boolean;
  /**
   * Recall synthesis: when true, dense recall (above ~5K tokens) is
   * folded through a one-shot Claude call into a focused briefing
   * before reaching Athena's chat session. Adds runtime Claude-call
   * cost on qualifying turns; off-by-default. Below-threshold turns
   * skip synthesis cleanly even when this flag is true.
   */
  athenaRecallSynthesisEnabled: boolean;
  /**
   * A2: when true, Athena may chain turns autonomously by emitting
   * `OP: continue_autonomously` — the backend schedules a follow-up
   * turn ~15s later. Toggle lives in the chat-panel header; any user
   * message cancels the pending continuation gracefully (the "stop"
   * UX is "type anything").
   */
  athenaAutonomousMode: boolean;
  /**
   * Fleet-orchestration BOLDNESS dial (Phase 2) — how aggressively Athena
   * auto-fires a `fleet_send_input` into a live CLI vs. surfacing it as an orb
   * consult, combined with her per-decision `decision_class` + `confidence`.
   * Only meaningful when autonomous mode is on. Mirrored server-side via
   * `companion_set_fleet_boldness`; the autoapprove gate reads it.
   */
  athenaFleetBoldness: FleetBoldnessLevel;
  /**
   * DEV MODE — Athena's self-development loop (debug builds only). When
   * true, her prompt gains the self-model addendum (this repo is the
   * app's own source; feature-talk resolves to code via the context map)
   * and she may propose `dev_improve` dispatches. Toggle is the wrench
   * in the chat-panel header, rendered only when the backend reports
   * `devModeAvailable` (debug build). Mirrored server-side via
   * `companion_set_dev_mode` for the prompt assembler + executor.
   */
  athenaDevMode: boolean;
  /**
   * P3 hands-free decision layer: when true, the decision queue
   * (`decision/useDecisionQueue`) aggregates pending approvals / human
   * reviews / blocking incidents and auto-surfaces them one-at-a-time in the
   * orb decision bubble. Off by default so the hands-free surface never
   * appears unless the user opts in; when off the queue does nothing (the
   * bubble can still be driven manually / by tests).
   */
  athenaHandsFreeDecisions: boolean;
  /**
   * Which attention kinds are expanded below the chat panel's counts bar.
   * Persisted on purpose: the six alert surfaces used to stack
   * unconditionally and bury the conversation, so the shape the user
   * settles on has to survive a panel reopen and an app restart. Only
   * `blocked` starts open (something is genuinely waiting on the user);
   * every other kind stays a count until they ask for it.
   */
  athenaAlertsExpanded: AttentionKind[];
  /**
   * Currently-typed intent in `UnifiedBuildEntry`, mirrored into the
   * slice so the Decisions panel can auto-scope its filter to the
   * persona the user is actively designing. Not persisted (session-
   * scoped UI affordance — surprising to resume "currently designing"
   * state across app restarts). Cleared on launch success and on
   * `UnifiedBuildEntry` re-mount with an empty initial intent.
   */
  activeBuildIntent: string | null;
  /**
   * Create Athena wizard — the persisted step pointer. `null` = never
   * started (or restarted). Persisted because an engine install is a side
   * effect that outlives the page: re-entering resumes where the user was.
   */
  athenaOnboardingStep: CreateAthenaStepId | null;
  /** ISO stamp of the last completed Create Athena run; `null` until then. */
  athenaOnboardingCompletedAt: string | null;

  setAthenaOnboardingStep: (step: CreateAthenaStepId | null) => void;
  setAthenaOnboardingCompletedAt: (at: string | null) => void;
  setCompanionPluginTab: (tab: CompanionPluginTab) => void;
  setAthenaFooterEnabled: (v: boolean) => void;
  setAthenaSoundEnabled: (v: boolean) => void;
  setAthenaVoiceEnabled: (v: boolean) => void;
  setAthenaVoiceEngine: (e: AthenaTtsEngine) => void;
  setAthenaKokoroVoiceId: (id: string | null) => void;
  setAthenaPocketVoiceId: (id: string | null) => void;
  setAthenaVoiceSpeed: (v: number | null) => void;
  setAthenaVoiceVolume: (v: number) => void;
  setAthenaPrefill: (p: AthenaPrefill | null) => void;
  setAthenaLabJump: (j: AthenaLabJump | null) => void;
  setAthenaPanelCompact: (v: boolean) => void;
  setAthenaSidePanelSlot: (v: 'fleet' | null) => void;
  setAthenaOrbEnabled: (v: boolean) => void;
  setAthenaOrbPos: (p: OrbPosition) => void;
  setAthenaSttEngine: (e: AthenaSttEngine) => void;
  setAthenaSttModelId: (id: string | null) => void;
  setAthenaGlobalHotkeyEnabled: (enabled: boolean) => void;
  setAthenaRecallSynthesisEnabled: (v: boolean) => void;
  setAthenaAutonomousMode: (v: boolean) => void;
  setAthenaFleetBoldness: (v: FleetBoldnessLevel) => void;
  setAthenaDevMode: (v: boolean) => void;
  setAthenaHandsFreeDecisions: (v: boolean) => void;
  /** Flip one attention kind between "just a count" and "cards shown". */
  toggleAthenaAlertKind: (kind: AttentionKind) => void;
  setActiveBuildIntent: (intent: string | null) => void;
}

export const createAthenaSlice: StateCreator<
  SystemStore,
  [],
  [],
  AthenaSlice
> = (set) => ({
  companionPluginTab: 'setup',
  athenaFooterEnabled: true,
  athenaSoundEnabled: true,
  athenaVoiceEnabled: false,
  athenaVoiceEngine: 'kokoro',
  athenaKokoroVoiceId: null,
  athenaPocketVoiceId: null,
  athenaVoiceSpeed: null,
  athenaVoiceVolume: 0.5,
  athenaPrefill: null,
  athenaLabJump: null,
  athenaPanelCompact: false,
  athenaSidePanelSlot: 'fleet',
  athenaOrbEnabled: true,
  athenaOrbPos: { x: 1, y: 0.82 },
  athenaSttEngine: 'browser',
  athenaSttModelId: null,
  athenaGlobalHotkeyEnabled: false,
  athenaRecallSynthesisEnabled: false,
  athenaAutonomousMode: false,
  athenaFleetBoldness: 'bold',
  athenaDevMode: false,
  athenaHandsFreeDecisions: false,
  athenaAlertsExpanded: DEFAULT_EXPANDED_KINDS,
  activeBuildIntent: null,
  athenaOnboardingStep: null,
  athenaOnboardingCompletedAt: null,

  setAthenaOnboardingStep: (athenaOnboardingStep) => set({ athenaOnboardingStep }),
  setAthenaOnboardingCompletedAt: (athenaOnboardingCompletedAt) =>
    set({ athenaOnboardingCompletedAt }),
  setCompanionPluginTab: (companionPluginTab) => set({ companionPluginTab }),
  setAthenaFooterEnabled: (athenaFooterEnabled) =>
    set({ athenaFooterEnabled }),
  setAthenaSoundEnabled: (athenaSoundEnabled) =>
    set({ athenaSoundEnabled }),
  setAthenaVoiceEnabled: (athenaVoiceEnabled) =>
    set({ athenaVoiceEnabled }),
  setAthenaVoiceEngine: (athenaVoiceEngine) =>
    set({ athenaVoiceEngine }),
  setAthenaKokoroVoiceId: (athenaKokoroVoiceId) =>
    set({ athenaKokoroVoiceId }),
  setAthenaPocketVoiceId: (athenaPocketVoiceId) =>
    set({ athenaPocketVoiceId }),
  setAthenaVoiceSpeed: (athenaVoiceSpeed) => set({ athenaVoiceSpeed }),
  setAthenaVoiceVolume: (athenaVoiceVolume) => set({ athenaVoiceVolume }),
  setAthenaPrefill: (athenaPrefill) => set({ athenaPrefill }),
  setAthenaLabJump: (athenaLabJump) => set({ athenaLabJump }),
  setAthenaPanelCompact: (athenaPanelCompact) => set({ athenaPanelCompact }),
  setAthenaSidePanelSlot: (athenaSidePanelSlot) => set({ athenaSidePanelSlot }),
  setAthenaOrbEnabled: (athenaOrbEnabled) => set({ athenaOrbEnabled }),
  setAthenaOrbPos: (athenaOrbPos) => set({ athenaOrbPos }),
  setAthenaSttEngine: (athenaSttEngine) => set({ athenaSttEngine }),
  setAthenaSttModelId: (athenaSttModelId) => set({ athenaSttModelId }),
  setAthenaGlobalHotkeyEnabled: (athenaGlobalHotkeyEnabled) =>
    set({ athenaGlobalHotkeyEnabled }),
  setAthenaRecallSynthesisEnabled: (athenaRecallSynthesisEnabled) =>
    set({ athenaRecallSynthesisEnabled }),
  setAthenaAutonomousMode: (athenaAutonomousMode) =>
    set({ athenaAutonomousMode }),
  setAthenaFleetBoldness: (athenaFleetBoldness) =>
    set({ athenaFleetBoldness }),
  setAthenaDevMode: (athenaDevMode) => set({ athenaDevMode }),
  setAthenaHandsFreeDecisions: (athenaHandsFreeDecisions) =>
    set({ athenaHandsFreeDecisions }),
  toggleAthenaAlertKind: (kind) =>
    set((s) => ({
      athenaAlertsExpanded: s.athenaAlertsExpanded.includes(kind)
        ? s.athenaAlertsExpanded.filter((k) => k !== kind)
        : [...s.athenaAlertsExpanded, kind],
    })),
  setActiveBuildIntent: (activeBuildIntent) => set({ activeBuildIntent }),
});
