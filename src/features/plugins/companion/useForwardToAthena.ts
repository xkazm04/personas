import { useCallback } from 'react';
import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';
import { silentCatch } from '@/lib/silentCatch';
import { useCompanionStore } from './companionStore';
import { useTtsSettings } from './useTtsSettings';
import { synthesize, play } from './voicePlayback';

/**
 * Forward a pre-composed message to Athena via the floating **orb** (not the
 * full chat panel). Used by outside surfaces like the dashboard "Ask Athena"
 * button.
 *
 * On invoke it:
 *  1. Surfaces the orb (`minimized`) — or the panel (`open`) as a fallback when
 *     the orb feature is disabled, so the message never goes to a dead end.
 *  2. Fires the one-shot amber "message received" ack glow on the orb
 *     (`pulseForwardAck`) for immediate visual confirmation.
 *  3. Sends the turn through the always-mounted `voiceTurnRequest` consumer in
 *     `CompanionPanel`, so it runs with the panel closed (orb-only).
 *  4. When voice is enabled + configured, speaks a short, scripted, translated
 *     acknowledgement ("Understood, processing the message.") — the real reply
 *     can take a long time, so this gives an instant audible cue.
 *
 * Returns a stable `forward(message)` callback.
 */
export function useForwardToAthena(): (message: string) => void {
  const { t } = useTranslation();
  const voiceSettings = useTtsSettings();
  const orbEnabled = useSystemStore((s) => s.companionOrbEnabled);
  const voiceEnabled = useSystemStore((s) => s.companionVoiceEnabled);
  const voiceEngine = useSystemStore((s) => s.companionVoiceEngine);
  const voiceCredentialId = useSystemStore((s) => s.companionVoiceCredentialId);
  const voiceId = useSystemStore((s) => s.companionVoiceId);
  const piperVoiceId = useSystemStore((s) => s.companionPiperVoiceId);
  const ackSpeech = t.plugins.companion.forward_ack_speech;

  return useCallback(
    (message: string) => {
      if (!message.trim()) return;
      const store = useCompanionStore.getState();
      // Surface the orb (fall back to the panel when the orb is disabled so
      // the forwarded message is never invisible), then ack + send.
      store.setState(orbEnabled ? 'minimized' : 'open');
      store.pulseForwardAck();
      store.setVoiceTurnRequest(message);

      // Immediate spoken acknowledgement — the turn itself can take a while.
      const synthesisVoiceId = voiceEngine === 'piper' ? piperVoiceId : voiceId;
      const voiceConfigured =
        voiceEngine === 'piper' ? !!piperVoiceId : !!voiceCredentialId && !!voiceId;
      if (voiceEnabled && voiceConfigured && synthesisVoiceId) {
        const synthesisCredentialId = voiceEngine === 'piper' ? null : voiceCredentialId;
        void synthesize(ackSpeech, synthesisCredentialId, synthesisVoiceId, voiceSettings, voiceEngine)
          .then((url) => {
            const { done } = play(url);
            done
              .catch(silentCatch('forward_to_athena_ack_play'))
              .finally(() => URL.revokeObjectURL(url));
          })
          .catch(silentCatch('forward_to_athena_ack_synthesize'));
      }
    },
    [orbEnabled, voiceEnabled, voiceEngine, voiceCredentialId, voiceId, piperVoiceId, voiceSettings, ackSpeech],
  );
}
