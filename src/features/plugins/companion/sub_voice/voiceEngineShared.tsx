import { useCallback, useEffect, useRef, useState } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import {
  CheckCircle2,
  Download,
  ExternalLink,
  Loader2,
  Play,
  Square,
} from 'lucide-react';
import { CopyButton } from '@/features/shared/components/buttons/CopyButton';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { useTranslation } from '@/i18n/useTranslation';
import { silentCatch } from '@/lib/silentCatch';
import type { SidecarInstallProgress, TtsEngineId } from '@/api/companion';
import { synthesize, play } from '../voicePlayback';
import { useTtsSettings } from '../useTtsSettings';

/**
 * Shared voice-engine setup/install/preview scaffold, extracted out of
 * KokoroVoicePanel and PocketVoicePanel (they were byte-for-byte identical
 * apart from the download command, event channel, and a few labels/icons —
 * see refactor-bughunt-2026-07-10 findings #5 and #9). Both panels
 * (and any future engine panel with the same shape, e.g. Piper) consume
 * these instead of re-authoring the scaffold per engine.
 */

interface SetupRowProps {
  icon: React.ReactNode;
  label: string;
  installed: boolean;
  installedText: string;
  hint: string;
  pathLabel: string;
  path: string;
  url: string;
}

/** Installed/not-installed engine or model row with download link + copy-path. */
export function SetupRow({ icon, label, installed, installedText, hint, pathLabel, path, url }: SetupRowProps) {
  const { t } = useTranslation();
  return (
    <div className="rounded-card border border-foreground/10 bg-secondary/20 p-3">
      <div className="flex items-center gap-2">
        <span className={installed ? 'text-emerald-400' : 'text-foreground'}>{icon}</span>
        <span className="typo-title">{label}</span>
        <span
          className={`ml-auto inline-flex items-center gap-1 typo-caption px-2 py-0.5 rounded-full ${
            installed ? 'bg-emerald-500/10 text-emerald-400' : 'bg-foreground/5 text-foreground'
          }`}
        >
          {installed && <CheckCircle2 className="w-3 h-3" />}
          {installed
            ? t.plugins.companion.voice_kokoro_installed
            : t.plugins.companion.voice_kokoro_not_installed}
        </span>
      </div>
      {installed ? (
        <div className="typo-code text-[11px] text-foreground mt-1.5 break-all" title={installedText}>
          {installedText}
        </div>
      ) : (
        <div className="mt-2 space-y-2">
          <p className="typo-caption">{hint}</p>
          <div className="flex items-center gap-1.5">
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-interactive bg-primary/15 hover:bg-primary/25 text-primary typo-caption font-medium transition-colors focus-ring"
            >
              <ExternalLink className="w-3 h-3" />
              {t.plugins.companion.voice_kokoro_download}
            </a>
            <CopyButton text={url} tooltip={t.plugins.companion.voice_kokoro_copy_url} />
          </div>
          <div>
            <div className="typo-caption text-foreground">{pathLabel}</div>
            <div className="flex items-center gap-1.5 mt-1">
              <code className="flex-1 typo-code text-[11px] text-foreground bg-secondary/40 rounded-input px-2 py-1 break-all">
                {path}
              </code>
              <CopyButton text={path} tooltip={t.plugins.companion.voice_kokoro_copy_path} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

interface VoiceEngineInstallBlockProps {
  /** Tauri event channel the backend streams install progress on. */
  progressEvent: string;
  /** Kicks off the download/extract on the backend. */
  onDownload: () => Promise<void>;
  /** Called once the backend reports `completed` — parent re-checks status. */
  onDone: () => void;
  icon: React.ReactNode;
  title: string;
  desc: string;
  installButtonLabel: string;
  /** Sentry/console breadcrumb prefix (e.g. `'kokoro.install'`). */
  logPrefix: string;
}

/**
 * One-click install affordance — downloads + extracts an engine sidecar +
 * model via the backend, streaming progress on `progressEvent`. On
 * completion it calls `onDone` (the parent's status refresh) so the
 * Installed badges + voice picker flip live without a manual re-check.
 */
export function VoiceEngineInstallBlock({
  progressEvent,
  onDownload,
  onDone,
  icon,
  title,
  desc,
  installButtonLabel,
  logPrefix,
}: VoiceEngineInstallBlockProps) {
  const { t } = useTranslation();
  const [installing, setInstalling] = useState(false);
  const [progress, setProgress] = useState<SidecarInstallProgress | null>(null);
  const unlistenRef = useRef<UnlistenFn | null>(null);

  useEffect(() => {
    let cancelled = false;
    listen<SidecarInstallProgress>(progressEvent, (evt) => {
      if (cancelled) return;
      setProgress(evt.payload);
      if (evt.payload.phase === 'completed') {
        setInstalling(false);
        onDone();
      } else if (evt.payload.phase === 'failed') {
        setInstalling(false);
      }
    })
      .then((u) => {
        if (cancelled) u();
        else unlistenRef.current = u;
      })
      .catch(silentCatch(`${logPrefix}.subscribe`));
    return () => {
      cancelled = true;
      unlistenRef.current?.();
      unlistenRef.current = null;
    };
  }, [progressEvent, onDone, logPrefix]);

  const onInstall = useCallback(async () => {
    setInstalling(true);
    setProgress({ phase: 'downloading_engine', bytesDownloaded: 0, bytesTotal: null, error: null });
    try {
      await onDownload();
    } catch (e) {
      setInstalling(false);
      setProgress({
        phase: 'failed',
        bytesDownloaded: 0,
        bytesTotal: null,
        error: e instanceof Error ? e.message : String(e),
      });
      silentCatch(logPrefix)(e);
    }
  }, [onDownload, logPrefix]);

  const phaseLabel = (p: SidecarInstallProgress['phase']): string => {
    switch (p) {
      case 'downloading_engine':
        return t.plugins.companion.voice_kokoro_install_engine;
      case 'downloading_model':
        return t.plugins.companion.voice_kokoro_install_model;
      case 'extracting':
        return t.plugins.companion.voice_kokoro_install_extract;
      case 'failed':
        return t.plugins.companion.voice_kokoro_install_failed;
      default:
        return '';
    }
  };

  const pct =
    progress?.bytesTotal && progress.bytesTotal > 0
      ? Math.round((progress.bytesDownloaded / progress.bytesTotal) * 100)
      : null;
  const isDownloading =
    progress?.phase === 'downloading_engine' || progress?.phase === 'downloading_model';
  const failed = progress?.phase === 'failed';

  return (
    <div className="rounded-card border border-primary/25 bg-primary/[0.06] p-3 space-y-2">
      <div className="flex items-center gap-2">
        {icon}
        <span className="typo-title text-primary">{title}</span>
      </div>
      <p className="typo-caption">{desc}</p>
      {installing ? (
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 typo-caption text-foreground">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            <span>{phaseLabel(progress?.phase ?? 'downloading_engine')}</span>
            {isDownloading && (
              <span className="ml-auto typo-code text-[11px]">
                {pct !== null ? (
                  `${pct}%`
                ) : (
                  <>
                    <Numeric value={progress!.bytesDownloaded / (1024 * 1024)} precision={0} /> MB
                  </>
                )}
              </span>
            )}
          </div>
          <div className="h-1 rounded-full bg-secondary/60 overflow-hidden">
            <div
              className={`h-full bg-primary transition-[width] ${pct === null ? 'animate-pulse w-1/3' : ''}`}
              style={pct !== null ? { width: `${pct}%` } : undefined}
            />
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={onInstall}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-interactive bg-primary/15 hover:bg-primary/25 text-primary typo-caption font-medium transition-colors focus-ring"
        >
          <Download className="w-3.5 h-3.5" />
          {installButtonLabel}
        </button>
      )}
      {failed && progress?.error && (
        <p className="typo-caption text-status-warning break-words">{progress.error}</p>
      )}
    </div>
  );
}

type PreviewState = 'idle' | 'synth' | 'playing';

/**
 * Per-voice audio-preview state machine — shared between Kokoro/Pocket (and
 * any future engine) voice rows. Handles the blob-URL lifecycle: synth →
 * play → cleanup (pause + `revokeObjectURL`) on completion, error, or
 * toggle-stop, plus teardown on unmount.
 */
export function useVoicePreview(voiceId: string, engine: TtsEngineId, logPrefix: string) {
  const { t } = useTranslation();
  const settings = useTtsSettings();
  const [previewState, setPreviewState] = useState<PreviewState>('idle');
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);

  const cleanup = useCallback(() => {
    audioRef.current?.pause();
    audioRef.current = null;
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
  }, []);

  useEffect(() => cleanup, [cleanup]);

  const onPreview = useCallback(async () => {
    if (previewState === 'playing' || previewState === 'synth') {
      cleanup();
      setPreviewState('idle');
      return;
    }
    setPreviewState('synth');
    try {
      const url = await synthesize(
        t.plugins.companion.voice_test_sentence,
        null,
        voiceId,
        settings,
        engine,
      );
      urlRef.current = url;
      const { audio, done } = play(url);
      audioRef.current = audio;
      setPreviewState('playing');
      await done.catch(silentCatch(`${logPrefix}.preview.play`));
      cleanup();
      setPreviewState('idle');
    } catch (e) {
      silentCatch(`${logPrefix}.preview.synth`)(e);
      cleanup();
      setPreviewState('idle');
    }
  }, [previewState, cleanup, t, voiceId, settings, engine, logPrefix]);

  return { previewState, onPreview };
}

interface PreviewButtonProps {
  previewState: PreviewState;
  onPreview: () => void;
  disabled?: boolean;
  title: string;
}

/** Play/stop toggle button for a voice preview, sharing the preview label + icon states. */
export function PreviewButton({ previewState, onPreview, disabled, title }: PreviewButtonProps) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={onPreview}
      disabled={disabled}
      title={title}
      className="inline-flex items-center gap-1 px-3 py-1 rounded-interactive bg-secondary/40 hover:bg-secondary/60 border border-foreground/10 text-foreground typo-caption transition-colors focus-ring disabled:opacity-40"
    >
      {previewState === 'synth' ? (
        <Loader2 className="w-3 h-3 animate-spin" />
      ) : previewState === 'playing' ? (
        <Square className="w-3 h-3" />
      ) : (
        <Play className="w-3 h-3" />
      )}
      {previewState === 'playing'
        ? t.plugins.companion.voice_kokoro_preview_stop
        : t.plugins.companion.voice_kokoro_preview}
    </button>
  );
}
