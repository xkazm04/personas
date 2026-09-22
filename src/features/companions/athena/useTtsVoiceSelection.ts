import { useSystemStore } from '@/stores/systemStore';
import {
  normalizeCompanionTtsEngine,
  type CompanionTtsEngine,
} from '@/stores/slices/system/companionPluginSlice';

/**
 * Resolved TTS identity for the currently-selected engine.
 *
 * Both engines keep independent voice selections in the store
 * (`companionKokoroVoiceId` for Kokoro, `companionPocketVoiceId` for
 * Pocket). Every playback call site needs the same things: which voice to
 * synth with and whether the engine is fully configured. This hook
 * centralizes that resolution so a new engine is a one-line change here.
 *
 * `credentialId` survives in the shape for call-site compatibility but is
 * always `null` — the cloud (ElevenLabs) engine was descoped 2026-07-10.
 * The persisted engine value is normalized so pre-descope localStorage
 * (`'elevenlabs'` / `'piper'`) lands on Kokoro instead of an impossible
 * engine.
 */
export interface ResolvedTtsVoice {
  engine: CompanionTtsEngine;
  /** Voice id to pass to `synthesize()`. Null when nothing is selected. */
  voiceId: string | null;
  /** Always `null` post-descope; kept for call-site shape stability. */
  credentialId: string | null;
  /** True when the selected engine has everything it needs to synthesize. */
  configured: boolean;
}

export function useTtsVoiceSelection(): ResolvedTtsVoice {
  const engine = normalizeCompanionTtsEngine(
    useSystemStore((s) => s.companionVoiceEngine),
  );
  const kokoroVoiceId = useSystemStore((s) => s.companionKokoroVoiceId);
  const pocketVoiceId = useSystemStore((s) => s.companionPocketVoiceId);

  switch (engine) {
    case 'pocket_tts':
      return { engine, voiceId: pocketVoiceId, credentialId: null, configured: !!pocketVoiceId };
    case 'kokoro':
    default:
      return { engine, voiceId: kokoroVoiceId, credentialId: null, configured: !!kokoroVoiceId };
  }
}
