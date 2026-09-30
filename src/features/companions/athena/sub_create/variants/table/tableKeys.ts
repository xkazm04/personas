/**
 * Create Athena "Table" shell: the keyboard. One function decides what a key
 * does on the current card, so the dock, the `?` sheet and the handler never
 * disagree. Picks that settle a card fold it and move on after a beat, the
 * winner's "answered cards collapse into a receipt"; picks that need a
 * listen first (voice, speech-to-text) wait for Continue.
 */
import type { CreateAthenaEngine } from '../../engine/createAthenaTypes';

export const FOLD_DELAY_MS = 320;

/** Run a settling pick, then advance once the choice has been seen. */
export function pickThenNext(engine: CreateAthenaEngine, pick: () => void): void {
  pick();
  setTimeout(() => engine.actions.next(), FOLD_DELAY_MS);
}

/** The primary action for Enter on this card, or `null` when Enter does nothing yet. */
export function primaryAction(engine: CreateAthenaEngine): (() => void) | null {
  const { card, actions, canNext } = engine;
  switch (card.kind) {
    case 'intro':
      return actions.next;
    case 'handoff':
      return actions.finish;
    case 'install':
      if (card.state.phase === 'idle') return actions.startInstall;
      if (card.state.phase === 'failed') return actions.retryInstall;
      if (card.state.phase === 'manual') return actions.recheckInstall;
      return canNext ? actions.next : null;
    default:
      return canNext ? actions.next : null;
  }
}

/** A digit picks the n-th option of the live card (1-based). */
export function digitAction(engine: CreateAthenaEngine, n: number): (() => void) | null {
  const { card, actions } = engine;
  switch (card.kind) {
    case 'keep_toggle':
      if (n === 1) return () => pickThenNext(engine, () => actions.keepFeature(card.feature, true));
      if (n === 2) return () => pickThenNext(engine, () => actions.keepFeature(card.feature, false));
      if (n === 3 && card.feature === 'chime') return actions.replayChime;
      return null;
    case 'orb_place':
      return n === 1 ? () => pickThenNext(engine, actions.confirmOrbPlace) : null;
    case 'engine_pick': {
      const opt = card.options[n - 1];
      return opt
        ? () => pickThenNext(engine, () => {
            actions.selectEngine(opt.id);
            actions.confirmEngine();
          })
        : null;
    }
    case 'voice_pick': {
      const v = card.voices[n - 1];
      return v ? () => actions.selectVoice(v.voiceId) : null;
    }
    case 'stt':
      if (n === 1) return () => actions.sttPick('browser');
      if (n === 2 && card.whisperInstalled) return () => actions.sttPick('whisper');
      return null;
    default:
      return null;
  }
}

/** Space: hear her on the voice card (the selected voice, else the first). */
export function hearAction(engine: CreateAthenaEngine): (() => void) | null {
  const { card, actions } = engine;
  if (card.kind !== 'voice_pick') return null;
  if (card.preview === 'playing') return actions.stopPreview;
  const id = card.selected ?? card.voices[0]?.voiceId;
  return id ? () => actions.previewVoice(id) : null;
}

export function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
}
