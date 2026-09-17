/**
 * Create Athena — the `stt` step. Composes `useSttComparison` (both engines
 * over one take) and adds what the card needs on top: whether whisper is
 * installed, and a translated mic-permission error when either engine
 * reports one. Leaving the step stops an open take.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { companionSttEngineStatus } from '@/api/companion';
import { useTranslation } from '@/i18n/useTranslation';
import { silentCatch } from '@/lib/silentCatch';
import { useSttComparison, type EngineTake } from '@/features/plugins/companion/useSttComparison';

/** Engine error codes / messages that mean "the mic was refused". */
const MIC_DENIED = /not.?allowed|mic_denied|permission|denied/i;

export interface CreateAthenaStt {
  recording: boolean;
  busy: boolean;
  browser: EngineTake;
  whisper: EngineTake;
  whisperInstalled: boolean;
  micError: string | null;
  start: () => void;
  stop: () => void;
}

export function micErrorFor(
  browserError: string | null,
  whisperError: string | null,
  deniedText: string,
): string | null {
  const hit = [browserError, whisperError].some((e) => e != null && MIC_DENIED.test(e));
  return hit ? deniedText : null;
}

export function useCreateAthenaStt(active: boolean): CreateAthenaStt {
  const { t } = useTranslation();
  const cmp = useSttComparison();
  const [whisperInstalled, setWhisperInstalled] = useState(false);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    companionSttEngineStatus()
      .then((s) => {
        if (!cancelled) setWhisperInstalled(s.installed);
      })
      .catch(silentCatch('createAthena.stt.engineStatus'));
    return () => {
      cancelled = true;
    };
  }, [active]);

  // Leaving the step (Back / Skip mid-take) must not leave two mics open.
  const cmpRef = useRef(cmp);
  cmpRef.current = cmp;
  useEffect(() => {
    if (!active && cmpRef.current.recording) cmpRef.current.stop();
  }, [active]);

  const start = useCallback(() => cmpRef.current.start(), []);
  const stop = useCallback(() => cmpRef.current.stop(), []);

  return {
    recording: cmp.recording,
    busy: cmp.busy,
    browser: cmp.browser,
    whisper: cmp.whisper,
    whisperInstalled,
    micError: micErrorFor(cmp.browser.error, cmp.whisper.error, t.plugins.companion.create_stt_mic_denied),
    start,
    stop,
  };
}
