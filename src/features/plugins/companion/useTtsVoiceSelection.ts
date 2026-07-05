import { useSystemStore } from '@/stores/systemStore';
import type { CompanionTtsEngine } from '@/stores/slices/system/companionPluginSlice';

/**
 * Resolved TTS identity for the currently-selected engine.
 *
 * Three engines keep independent voice selections in the store
 * (`companionVoiceId` for ElevenLabs, `companionPiperVoiceId` for Piper,
 * `companionKokoroVoiceId` for Kokoro) plus a shared credential id that only
 * ElevenLabs uses. Every playback call site needs the same three things:
 * which voice to synth with, which credential (or none), and whether the
 * engine is fully configured. That resolution used to be copy-pasted as a
 * `engine === 'piper' ? … : …` ternary in ~7 places — which meant adding a
 * third engine (Kokoro) would have to be done correctly in all of them.
 * This hook centralizes it so a new engine is a one-line change here.
 */
export interface ResolvedTtsVoice {
  engine: CompanionTtsEngine;
  /** Voice id to pass to `synthesize()`. Null when nothing is selected. */
  voiceId: string | null;
  /** Credential id — ElevenLabs only; `null` for the local engines. */
  credentialId: string | null;
  /** True when the selected engine has everything it needs to synthesize. */
  configured: boolean;
}

export function useTtsVoiceSelection(): ResolvedTtsVoice {
  const engine = useSystemStore((s) => s.companionVoiceEngine);
  const credentialId = useSystemStore((s) => s.companionVoiceCredentialId);
  const elevenVoiceId = useSystemStore((s) => s.companionVoiceId);
  const piperVoiceId = useSystemStore((s) => s.companionPiperVoiceId);
  const kokoroVoiceId = useSystemStore((s) => s.companionKokoroVoiceId);

  switch (engine) {
    case 'piper':
      return { engine, voiceId: piperVoiceId, credentialId: null, configured: !!piperVoiceId };
    case 'kokoro':
      return { engine, voiceId: kokoroVoiceId, credentialId: null, configured: !!kokoroVoiceId };
    case 'elevenlabs':
    default:
      return {
        engine,
        voiceId: elevenVoiceId,
        credentialId,
        configured: !!credentialId && !!elevenVoiceId,
      };
  }
}
