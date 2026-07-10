import { useMemo } from 'react';
import type { TtsSettings } from '@/api/companion';
import { useSystemStore } from '@/stores/systemStore';

/**
 * Bundle the companion voice tuning from systemStore into the `TtsSettings`
 * shape `companion_tts` accepts. Post-descope (2026-07-10) the only tunable
 * is speech rate — Kokoro maps it onto the sidecar's length-scale. Returns
 * `undefined` when nothing is customized so callers pass it through
 * verbatim and the backend applies its defaults.
 */
export function useTtsSettings(): TtsSettings | undefined {
  const speed = useSystemStore((s) => s.companionVoiceSpeed);

  return useMemo<TtsSettings | undefined>(
    () => (speed == null ? undefined : { speed }),
    [speed],
  );
}
