/**
 * Create Athena — engine status + one-click install for the chosen TTS
 * engine. Mirrors `VoiceEngineInstallBlock` (`sub_voice/voiceEngineShared.tsx`)
 * without rendering: subscribe to the progress event, kick the download,
 * map phases 1:1, re-read status on `completed`.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import {
  companionTtsKokoroDownload,
  companionTtsKokoroStatus,
  companionTtsPocketDownload,
  companionTtsPocketStatus,
  KOKORO_INSTALL_EVENT,
  POCKET_INSTALL_EVENT,
  type KokoroStatus,
  type PocketStatus,
  type SidecarInstallProgress,
  type TtsEngineId,
} from '@/api/companion';
import { silentCatch } from '@/lib/silentCatch';
import { installErrorText } from '@/features/plugins/companion/sub_voice/voiceEngineShared';
import type { EngineOption, InstallState } from './createAthenaTypes';

/** The status fields both engines share and the wizard reads. */
type EngineStatus = Pick<
  KokoroStatus,
  'engineInstalled' | 'modelInstalled' | 'canAutoInstall' | 'engineDownloadUrl' | 'modelDownloadUrl'
>;

const EMPTY_PROGRESS: SidecarInstallProgress = {
  phase: 'downloading_engine',
  bytesDownloaded: 0,
  bytesTotal: null,
  error: null,
};

function toOption(id: TtsEngineId, s: EngineStatus | null): EngineOption {
  return {
    id,
    installed: Boolean(s && s.engineInstalled && s.modelInstalled),
    canAutoInstall: s?.canAutoInstall ?? false,
  };
}

export interface CreateAthenaInstall {
  /** Both engines, for the `engine_pick` card. */
  options: EngineOption[];
  /** `true` once both statuses have been read at least once. */
  statusKnown: boolean;
  /** Install state for `engine`. */
  state: InstallState;
  /** `null` until `statusKnown`. */
  installed: (id: TtsEngineId) => boolean | null;
  startInstall: () => void;
  recheckInstall: () => void;
}

export function useCreateAthenaInstall(engine: TtsEngineId, wanted: boolean): CreateAthenaInstall {
  const [kokoro, setKokoro] = useState<KokoroStatus | null>(null);
  const [pocket, setPocket] = useState<PocketStatus | null>(null);
  const [statusKnown, setStatusKnown] = useState(false);
  const [progress, setProgress] = useState<SidecarInstallProgress | null>(null);
  const unlistenRef = useRef<UnlistenFn | null>(null);
  const mountedRef = useRef(true);

  const refresh = useCallback(() => {
    void Promise.all([
      companionTtsKokoroStatus().catch((e: unknown) => {
        silentCatch('createAthena.install.kokoroStatus')(e);
        return null;
      }),
      companionTtsPocketStatus().catch((e: unknown) => {
        silentCatch('createAthena.install.pocketStatus')(e);
        return null;
      }),
    ]).then(([k, p]) => {
      if (!mountedRef.current) return;
      setKokoro(k);
      setPocket(p);
      setStatusKnown(true);
    });
  }, []);

  useEffect(() => {
    if (wanted && !statusKnown) refresh();
  }, [wanted, statusKnown, refresh]);

  // A previous engine's download progress means nothing for the new one.
  useEffect(() => {
    setProgress(null);
  }, [engine]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      unlistenRef.current?.();
      unlistenRef.current = null;
    };
  }, []);

  const startInstall = useCallback(() => {
    unlistenRef.current?.();
    unlistenRef.current = null;
    setProgress(EMPTY_PROGRESS);
    const event = engine === 'kokoro' ? KOKORO_INSTALL_EVENT : POCKET_INSTALL_EVENT;
    const download = engine === 'kokoro' ? companionTtsKokoroDownload : companionTtsPocketDownload;
    void (async () => {
      try {
        // Subscribe BEFORE the download so the first progress frame is not lost.
        const unlisten = await listen<SidecarInstallProgress>(event, (evt) => {
          if (!mountedRef.current) return;
          setProgress(evt.payload);
          if (evt.payload.phase === 'completed' || evt.payload.phase === 'failed') {
            unlistenRef.current?.();
            unlistenRef.current = null;
            if (evt.payload.phase === 'completed') refresh();
          }
        });
        if (!mountedRef.current) {
          unlisten();
          return;
        }
        unlistenRef.current = unlisten;
        await download();
      } catch (e) {
        silentCatch(`createAthena.install.${engine}`)(e);
        if (!mountedRef.current) return;
        setProgress({ ...EMPTY_PROGRESS, phase: 'failed', error: installErrorText(e) });
      }
    })();
  }, [engine, refresh]);

  const statusFor = useCallback(
    (id: TtsEngineId): EngineStatus | null => (id === 'kokoro' ? kokoro : pocket),
    [kokoro, pocket],
  );

  const installed = useCallback(
    (id: TtsEngineId): boolean | null => (statusKnown ? toOption(id, statusFor(id)).installed : null),
    [statusKnown, statusFor],
  );

  const state = useMemo<InstallState>(() => {
    const s = statusFor(engine);
    const base = { bytesDownloaded: 0, bytesTotal: null, error: null, engineDownloadUrl: null, modelDownloadUrl: null };
    // A finished download stays `completed` (line + Next) even though the
    // re-read status now says installed — `not_needed` is only for engines
    // that were already there when the step opened.
    if (progress) {
      return {
        ...base,
        phase: progress.phase,
        bytesDownloaded: progress.bytesDownloaded,
        bytesTotal: progress.bytesTotal,
        error: progress.error,
      };
    }
    if (s && s.engineInstalled && s.modelInstalled) return { ...base, phase: 'not_needed' };
    if (s && !s.canAutoInstall) {
      return {
        ...base,
        phase: 'manual',
        engineDownloadUrl: s.engineDownloadUrl,
        modelDownloadUrl: s.modelDownloadUrl,
      };
    }
    return { ...base, phase: 'idle' };
  }, [engine, progress, statusFor]);

  const options = useMemo<EngineOption[]>(
    () => [toOption('kokoro', kokoro), toOption('pocket_tts', pocket)],
    [kokoro, pocket],
  );

  return { options, statusKnown, state, installed, startInstall, recheckInstall: refresh };
}
