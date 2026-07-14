import { useCallback, useEffect, useState } from 'react';
import { Mic } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { AsyncButton } from '@/features/shared/components/buttons';
import { toastCatch } from '@/lib/silentCatch';
import { useToastStore } from '@/stores/toastStore';
import {
  artistListVoiceoverVoices,
  artistProbeMedia,
  artistSynthesizeVoiceover,
  artistVoiceoverStatus,
} from '@/api/artist';
import type { KokoroVoiceEntry } from '@/api/companion';
import { IconPopover } from './toolbar/IconPopover';

export interface VoiceoverClipInput {
  filePath: string;
  duration: number;
  label: string;
}

interface VoiceoverButtonProps {
  /** Adds the synthesized narration to the timeline as an audio clip. */
  onGenerated: (clip: VoiceoverClipInput) => void;
}

/**
 * Generate a narration track from text using the local Kokoro TTS sidecar, then
 * drop it on the timeline. Closes the "script → voiceover → synced timeline"
 * loop the explainer-video workflow needs — the same Kokoro engine the
 * companion uses, no external service or API key.
 */
export default function VoiceoverButton({ onGenerated }: VoiceoverButtonProps) {
  const { t } = useTranslation();
  const [voices, setVoices] = useState<KokoroVoiceEntry[]>([]);
  const [voiceId, setVoiceId] = useState('');
  const [text, setText] = useState('');
  const [ready, setReady] = useState<boolean | null>(null);

  // Load voices + install status once, lazily on first mount.
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const [list, status] = await Promise.all([
          artistListVoiceoverVoices(),
          artistVoiceoverStatus(),
        ]);
        if (!alive) return;
        setVoices(list);
        setVoiceId((prev) => prev || list[0]?.voiceId || '');
        setReady(status.engineInstalled && status.modelInstalled);
      } catch (err) {
        if (alive) setReady(false);
        toastCatch('Voiceover status')(err);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const generate = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed || !voiceId) return;
    const result = await artistSynthesizeVoiceover(trimmed, voiceId);
    const probe = await artistProbeMedia(result.filePath);
    onGenerated({
      filePath: result.filePath,
      duration: probe.duration,
      label: trimmed.length > 24 ? `${trimmed.slice(0, 24)}…` : trimmed,
    });
    useToastStore.getState().addToast(t.media_studio.voiceover_added, 'success');
    setText('');
  }, [text, voiceId, onGenerated, t]);

  return (
    <IconPopover icon={Mic} title={t.media_studio.voiceover} widthPx={280}>
      <div className="space-y-3">
        {ready === false && (
          <p className="text-md text-amber-400">{t.media_studio.voiceover_not_installed}</p>
        )}

        <label className="block space-y-1">
          <span className="typo-label text-foreground">{t.media_studio.voiceover_text}</span>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t.media_studio.voiceover_text_placeholder}
            rows={3}
            className="w-full px-2 py-1.5 text-md bg-secondary/40 border border-primary/10 rounded-card text-foreground placeholder:text-foreground/40 resize-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
          />
        </label>

        <label className="block space-y-1">
          <span className="typo-label text-foreground">{t.media_studio.voiceover_voice}</span>
          <select
            value={voiceId}
            onChange={(e) => setVoiceId(e.target.value)}
            className="w-full px-2 py-1.5 text-md bg-secondary/40 border border-primary/10 rounded-card text-foreground"
          >
            {voices.map((v) => (
              <option key={v.voiceId} value={v.voiceId}>
                {v.speaker} · {v.languageLabel}
              </option>
            ))}
          </select>
        </label>

        <AsyncButton
          variant="accent"
          size="sm"
          className="w-full"
          disabled={!text.trim() || !voiceId || ready === false}
          onClick={generate}
          loadingText={t.media_studio.voiceover_generating}
        >
          {t.media_studio.voiceover_generate}
        </AsyncButton>
      </div>
    </IconPopover>
  );
}
