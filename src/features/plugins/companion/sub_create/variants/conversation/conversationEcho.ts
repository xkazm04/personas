import type { CreateAthenaCard } from '../../engine/createAthenaTypes';

/** The slice of `t.plugins.companion` the echo needs — kept narrow so tests can hand-build it. */
export interface EchoStrings {
  create_start: string;
  create_resume: string;
  create_keep: string;
  create_turn_off: string;
  create_orb_place_done: string;
  create_engine_kokoro_title: string;
  create_engine_pocket_title: string;
  create_install_done: string;
  create_stt_browser: string;
  create_stt_whisper: string;
}

/**
 * The user's side of the exchange, compressed to a few words for the exit
 * animation — "Keep it", the engine name, the voice label. `null` when the
 * step had no answer worth echoing (an unmade choice, the handoff).
 */
export function echoFor(card: CreateAthenaCard, c: EchoStrings): string | null {
  switch (card.kind) {
    case 'intro':
      return card.mode === 'resume' ? c.create_resume : c.create_start;
    case 'keep_toggle':
      if (card.choice === null) return null;
      return card.choice === 'keep' ? c.create_keep : c.create_turn_off;
    case 'orb_place':
      return card.confirmed ? c.create_orb_place_done : null;
    case 'engine_pick':
      return card.selected === 'kokoro' ? c.create_engine_kokoro_title : c.create_engine_pocket_title;
    case 'install':
      return card.state.phase === 'completed' || card.state.phase === 'not_needed'
        ? c.create_install_done
        : null;
    case 'voice_pick':
      return card.voices.find((v) => v.voiceId === card.selected)?.label ?? null;
    case 'stt':
      if (card.picked === null) return null;
      return card.picked === 'browser' ? c.create_stt_browser : c.create_stt_whisper;
    case 'handoff':
      return null;
  }
}
