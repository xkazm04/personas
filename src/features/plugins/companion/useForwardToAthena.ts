import { useCallback } from 'react';
import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';
import { silentCatch } from '@/lib/silentCatch';
import { companionCreateConversation } from '@/api/companion';
import { useCompanionStore } from './companionStore';
import { useTtsSettings } from './useTtsSettings';
import { useTtsVoiceSelection } from './useTtsVoiceSelection';
import { synthesize, play } from './voicePlayback';

/** A concise thread title from the forwarded prompt's first line. */
function titleFromMessage(message: string): string {
  const firstLine = (message.trim().split('\n')[0] ?? '').trim();
  return firstLine.length > 48 ? `${firstLine.slice(0, 47)}…` : firstLine;
}

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
  const voice = useTtsVoiceSelection();
  const ackSpeech = t.plugins.companion.forward_ack_speech;

  return useCallback(
    (message: string) => {
      if (!message.trim()) return;
      const store = useCompanionStore.getState();
      // Surface the orb (fall back to the panel when the orb is disabled so
      // the forwarded message is never invisible), then ack + send.
      store.setState(orbEnabled ? 'minimized' : 'open');
      store.pulseForwardAck();

      // Forwarded asks open their OWN conversation so they never collide with
      // whatever thread is current (design §5 — that collision is the confusion
      // we're fixing). Create → focus → send into it; the panel's voiceTurnRequest
      // consumer reads the active conversation id when it fires the turn.
      companionCreateConversation(titleFromMessage(message), 'forwarded')
        .then((row) => {
          const s = useCompanionStore.getState();
          s.upsertConversation(row);
          s.setActiveConversationId(row.id);
          s.setVoiceTurnRequest(message);
        })
        .catch((err) => {
          // Never drop the message: if the thread couldn't be created, fall back
          // to sending it into the current conversation.
          silentCatch('companion_create_conversation')(err);
          useCompanionStore.getState().setVoiceTurnRequest(message);
        });

      // Immediate spoken acknowledgement — the turn itself can take a while.
      if (voiceEnabled && voice.configured && voice.voiceId) {
        void synthesize(ackSpeech, voice.credentialId, voice.voiceId, voiceSettings, voice.engine)
          .then((url) => {
            const { done } = play(url);
            done
              .catch(silentCatch('forward_to_athena_ack_play'))
              .finally(() => URL.revokeObjectURL(url));
          })
          .catch(silentCatch('forward_to_athena_ack_synthesize'));
      }
    },
    [orbEnabled, voiceEnabled, voice.engine, voice.voiceId, voice.credentialId, voice.configured, voiceSettings, ackSpeech],
  );
}
