import { useCallback, useEffect, useRef } from 'react';
import { toastCatch } from '@/lib/silentCatch';
import { play, synthesize } from '@/features/plugins/companion/voicePlayback';
import { useTtsVoiceSelection } from '@/features/plugins/companion/useTtsVoiceSelection';
import { useTtsSettings } from '@/features/plugins/companion/useTtsSettings';

// "Read aloud" from Athena's tool arc: speaks her latest reply through the same
// companion TTS engine and voice the Athena chat uses. Configured = the user
// has a voice set up; otherwise the tool says so instead of failing.
export function useGuideReadAloud() {
  const voice = useTtsVoiceSelection();
  const settings = useTtsSettings();
  const audio = useRef<HTMLAudioElement | null>(null);
  const url = useRef<string | null>(null);

  const stop = useCallback(() => {
    audio.current?.pause();
    audio.current = null;
    if (url.current) URL.revokeObjectURL(url.current);
    url.current = null;
  }, []);
  useEffect(() => stop, [stop]);

  const speak = useCallback(
    (text: string) => {
      if (!voice.configured) return;
      stop();
      synthesize(text, voice.credentialId, voice.voiceId ?? '', settings, voice.engine)
        .then((u) => {
          url.current = u;
          const p = play(u);
          audio.current = p.audio;
          return p.done;
        })
        .catch(toastCatch('read aloud'));
    },
    [voice, settings, stop],
  );

  return { configured: voice.configured, speak, stop };
}
