import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { TtsSettings } from '@/api/companion';
import { useSystemStore } from '@/stores/systemStore';

/**
 * Bundle the five companion voice tuning fields from systemStore into the
 * `TtsSettings` shape `companion_tts` accepts. Returns `undefined` when
 * every field is null so callers can pass it through verbatim and let the
 * backend apply its defaults — that keeps the wire payload minimal for
 * users who never opened the Voice settings panel.
 */
export function useTtsSettings(): TtsSettings | undefined {
  const fields = useSystemStore(
    useShallow((s) => ({
      modelId: s.companionVoiceModel,
      stability: s.companionVoiceStability,
      similarityBoost: s.companionVoiceSimilarity,
      speed: s.companionVoiceSpeed,
      style: s.companionVoiceStyle,
    })),
  );

  return useMemo<TtsSettings | undefined>(() => {
    const out: TtsSettings = {};
    if (fields.modelId != null) out.modelId = fields.modelId;
    if (fields.stability != null) out.stability = fields.stability;
    if (fields.similarityBoost != null) out.similarityBoost = fields.similarityBoost;
    if (fields.speed != null) out.speed = fields.speed;
    if (fields.style != null) out.style = fields.style;
    return Object.keys(out).length === 0 ? undefined : out;
  }, [fields]);
}
