/**
 * Create Athena — the ONE engine behind the three shells.
 *
 * The step pointer is persisted (`useSystemStore.athenaOnboardingStep`) so a
 * closed wizard resumes; per-step choices live in a local reducer, except
 * what the real store keys already record (footer/orb/chime enabled, engine,
 * voice ids, STT engine). Setup steps flip their real key ON on entry and
 * glow the chrome via `flashHighlight`; `keepFeature` records the answer.
 */
import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { SttEngineId, TtsEngineId } from '@/api/companion';
import { useTranslation } from '@/i18n/useTranslation';
import { useSystemStore } from '@/stores/systemStore';
import { useCompanionStore } from '@/features/companions/athena/companionStore';
import { playReplyChime } from '@/features/companions/athena/chime';
import {
  deriveSteps,
  resolveLine,
  resolveMove,
  stepIndexOf,
  type AutoSkipContext,
} from './createAthenaSteps';
import {
  CREATE_ATHENA_HIGHLIGHT_TEST_IDS,
  CREATE_ATHENA_STEP_ORDER,
  type CreateAthenaCard,
  type CreateAthenaEngine,
  type CreateAthenaFeature,
  type CreateAthenaStepId,
} from './createAthenaTypes';
import { initialLocal, reduceLocal } from './createAthenaLocalState';
import { useCreateAthenaHandoff } from './useCreateAthenaHandoff';
import { useCreateAthenaInstall } from './useCreateAthenaInstall';
import { useCreateAthenaStt } from './useCreateAthenaStt';
import { useCreateAthenaVoices } from './useCreateAthenaVoices';

const VOICE_FROM = stepIndexOf('voice_engine');

export function useCreateAthenaEngine(): CreateAthenaEngine {
  const { t } = useTranslation();
  const c = t.plugins.companion;
  const sys = useSystemStore(
    useShallow((s) => ({
      stored: s.athenaOnboardingStep,
      completedAt: s.athenaOnboardingCompletedAt,
      setStep: s.setAthenaOnboardingStep,
      footer: s.companionFooterEnabled,
      orb: s.companionOrbEnabled,
      sound: s.companionSoundEnabled,
      engine: s.companionVoiceEngine,
      kokoroVoice: s.companionKokoroVoiceId,
      pocketVoice: s.companionPocketVoiceId,
    })),
  );
  const stepId: CreateAthenaStepId = sys.stored ?? 'intro';
  const stepIndex = stepIndexOf(stepId);
  const engine: TtsEngineId = sys.engine;

  const [local, dispatch] = useReducer(
    reduceLocal,
    // Mount-time only: a stored pointer past the intro means "we were partway".
    sys.stored && sys.stored !== 'intro' ? 'resume' : sys.completedAt ? 'done' : 'fresh',
    initialLocal,
  );

  const install = useCreateAthenaInstall(engine, stepIndex >= VOICE_FROM);
  const selectedVoice = engine === 'kokoro' ? sys.kokoroVoice : sys.pocketVoice;
  const selectVoice = useCallback(
    (voiceId: string) => {
      const s = useSystemStore.getState();
      if (s.companionVoiceEngine === 'kokoro') s.setCompanionKokoroVoiceId(voiceId);
      else s.setCompanionPocketVoiceId(voiceId);
    },
    [],
  );
  const onWoke = useCallback(
    (voiceId: string) => {
      dispatch({ type: 'woke' });
      selectVoice(voiceId);
    },
    [selectVoice],
  );
  const voices = useCreateAthenaVoices({ engine, active: stepId === 'voice_pick', wokeUp: local.wokeUp, onWoke });
  const stt = useCreateAthenaStt(stepId === 'stt');
  const voiceReady = selectedVoice !== null && install.installed(engine) === true;
  const handoff = useCreateAthenaHandoff(stepId === 'handoff', voiceReady);

  // --- navigation -------------------------------------------------------
  const skipCtx = useRef<AutoSkipContext>({ orbEnabled: true, installPhase: null });
  skipCtx.current = { orbEnabled: sys.orb, installPhase: install.statusKnown ? install.state.phase : null };

  const move = useCallback(
    (dir: 1 | -1, leaveAs: 'done' | 'skipped' | null) => {
      const from = useSystemStore.getState().athenaOnboardingStep ?? 'intro';
      const { target, passed } = resolveMove(from, dir, skipCtx.current);
      if (!target) return;
      const done = passed.filter((p) => p.as === 'done').map((p) => p.id);
      const skipped = passed.filter((p) => p.as === 'skipped').map((p) => p.id);
      if (leaveAs === 'done') done.push(from);
      if (leaveAs === 'skipped') skipped.push(from);
      dispatch({ type: 'mark', done, skipped });
      sys.setStep(target);
    },
    [sys],
  );

  // voice_install reached before status was known: leave once it says installed.
  useEffect(() => {
    if (stepId === 'voice_install' && install.statusKnown && install.state.phase === 'not_needed') {
      move(1, 'done');
    }
  }, [stepId, install.statusKnown, install.state.phase, move]);

  // --- step entry: flip the real key ON + hold the glow on the chrome ------
  // The guide ring (`guidanceHighlightTestId`, the walkthrough's persistent
  // highlight) stays on the footer icon / orb for the WHOLE step, so the user
  // cannot miss it; the one-shot flash ring only pulsed twice. Cleared when
  // the step is left, unless a walkthrough took the ring over meanwhile.
  useEffect(() => {
    const s = useSystemStore.getState();
    const companion = useCompanionStore.getState();
    const target =
      stepId === 'footer_icon'
        ? CREATE_ATHENA_HIGHLIGHT_TEST_IDS.footer_icon
        : stepId === 'orb'
          ? CREATE_ATHENA_HIGHLIGHT_TEST_IDS.orb
          : null;
    if (stepId === 'footer_icon') s.setCompanionFooterEnabled(true);
    else if (stepId === 'orb') s.setCompanionOrbEnabled(true);
    else if (stepId === 'chime') {
      s.setCompanionSoundEnabled(true);
      playReplyChime();
    }
    if (!target || companion.activeWalkthrough) return;
    companion.setGuidanceHighlightTestId(target);
    return () => {
      const now = useCompanionStore.getState();
      if (!now.activeWalkthrough && now.guidanceHighlightTestId === target) {
        now.setGuidanceHighlightTestId(null);
      }
    };
  }, [stepId]);

  // Leaving voice_pick silences a preview mid-sentence.
  const stopPreview = voices.stopPreview;
  useEffect(() => {
    if (stepId !== 'voice_pick') stopPreview();
  }, [stepId, stopPreview]);

  // --- actions ----------------------------------------------------------
  const steps = useMemo(
    () => deriveSteps(stepId, new Set(local.done), new Set(local.skipped)),
    [stepId, local.done, local.skipped],
  );

  const actions = useMemo(
    () => ({
      next: () => move(1, 'done'),
      back: () => move(-1, null),
      skip: () => move(1, 'skipped'),
      goTo: (id: CreateAthenaStepId) => {
        const st = steps.find((s) => s.id === id)?.status;
        if (st === 'done' || st === 'skipped') sys.setStep(id);
      },
      restart: () => {
        dispatch({ type: 'restart', introMode: useSystemStore.getState().athenaOnboardingCompletedAt ? 'done' : 'fresh' });
        sys.setStep('intro');
      },
      keepFeature: (feature: CreateAthenaFeature, keep: boolean) => {
        const s = useSystemStore.getState();
        if (feature === 'footer_icon') s.setCompanionFooterEnabled(keep);
        else if (feature === 'orb') s.setCompanionOrbEnabled(keep);
        else s.setCompanionSoundEnabled(keep);
        dispatch({ type: 'choice', feature, choice: keep ? 'keep' : 'off' });
      },
      confirmOrbPlace: () => dispatch({ type: 'orbConfirmed' }),
      replayChime: () => {
        if (useSystemStore.getState().companionSoundEnabled) playReplyChime();
      },
      selectEngine: (id: TtsEngineId) => {
        useSystemStore.getState().setCompanionVoiceEngine(id);
        dispatch({ type: 'engineConfirmed', value: false });
      },
      confirmEngine: () => dispatch({ type: 'engineConfirmed', value: true }),
      startInstall: install.startInstall,
      retryInstall: install.startInstall,
      recheckInstall: install.recheckInstall,
      selectVoice,
      previewVoice: voices.previewVoice,
      stopPreview: voices.stopPreview,
      sttStart: stt.start,
      sttStop: stt.stop,
      sttPick: (id: SttEngineId) => {
        useSystemStore.getState().setCompanionSttEngine(id);
        dispatch({ type: 'sttPicked', id });
      },
      finish: handoff.finish,
    }),
    [move, steps, sys, install.startInstall, install.recheckInstall, selectVoice, voices.previewVoice, voices.stopPreview, stt.start, stt.stop, handoff.finish],
  );

  // --- card + line ------------------------------------------------------
  const card = useMemo<CreateAthenaCard>(() => {
    switch (stepId) {
      case 'intro':
        return { kind: 'intro', mode: local.introMode };
      case 'footer_icon':
      case 'orb':
      case 'chime': {
        const enabled = stepId === 'footer_icon' ? sys.footer : stepId === 'orb' ? sys.orb : sys.sound;
        return { kind: 'keep_toggle', feature: stepId, enabled, recommended: 'keep', why: c[`create_why_${stepId}`], choice: local.choices[stepId] ?? null };
      }
      case 'orb_place':
        return { kind: 'orb_place', confirmed: local.orbConfirmed };
      case 'voice_engine':
        return { kind: 'engine_pick', options: install.options, selected: engine, recommended: 'kokoro', why: c.create_why_kokoro, confirmed: local.engineConfirmed };
      case 'voice_install':
        return { kind: 'install', engine, state: install.state };
      case 'voice_pick':
        return { kind: 'voice_pick', engine, voices: voices.voices, loading: voices.loading, selected: selectedVoice, previewVoiceId: voices.previewVoiceId, preview: voices.preview, wokeUp: local.wokeUp };
      case 'stt':
        return { kind: 'stt', recording: stt.recording, busy: stt.busy, browser: stt.browser, whisper: stt.whisper, whisperInstalled: stt.whisperInstalled, micError: stt.micError, picked: local.sttPicked };
      case 'handoff':
        return { kind: 'handoff', hasClaudeLogin: handoff.hasClaudeLogin, voiceReady };
    }
  }, [stepId, local, sys.footer, sys.orb, sys.sound, c, install.options, install.state, engine, voices, selectedVoice, stt, handoff.hasClaudeLogin, voiceReady]);

  const canNext = useMemo(() => {
    switch (card.kind) {
      case 'intro': return true;
      case 'keep_toggle': return card.choice !== null;
      case 'orb_place': return card.confirmed;
      case 'engine_pick': return card.confirmed;
      case 'install': return card.state.phase === 'completed' || card.state.phase === 'not_needed';
      case 'voice_pick': return card.selected !== null;
      case 'stt': return card.picked !== null;
      case 'handoff': return false;
    }
  }, [card]);

  const line = useMemo(
    () => resolveLine(c, stepId, { introMode: local.introMode, installPhase: install.state.phase, wokeUp: local.wokeUp, voiceReady }),
    [c, stepId, local.introMode, install.state.phase, local.wokeUp, voiceReady],
  );

  return {
    stepId,
    stepIndex,
    stepCount: CREATE_ATHENA_STEP_ORDER.length,
    steps,
    line,
    card,
    speaking: voices.speaking,
    canNext,
    canBack: stepIndex > 0,
    actions,
  };
}
