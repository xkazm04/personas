import { useCallback, useEffect, useRef, useState } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import {
  AudioWaveform,
  CheckCircle2,
  Cpu,
  Download,
  ExternalLink,
  FolderOpen,
  Loader2,
  Package,
  Play,
  RefreshCw,
  Square,
} from 'lucide-react';
import { SectionCard } from '@/features/shared/components/layout/SectionCard';
import { SettingRow } from '@/features/shared/components/forms/SettingRow';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { CopyButton } from '@/features/shared/components/buttons/CopyButton';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';
import { silentCatch } from '@/lib/silentCatch';
import {
  POCKET_INSTALL_EVENT,
  companionTtsListPocketVoices,
  companionTtsPocketDownload,
  companionTtsPocketStatus,
  type PocketInstallProgress,
  type PocketStatus,
  type PocketVoiceEntry,
} from '@/api/companion';
import { synthesize, play } from '../voicePlayback';
import { useTtsSettings } from '../useTtsSettings';

/**
 * Pocket TTS voice picker — the only local engine with zero-shot voice
 * cloning. Two interchangeable backends:
 *   1. **Packaged sidecar** (the shippable default): the shared sherpa-onnx
 *      binary + a ~98MB int8 model, one-click installed like Kokoro. Any
 *      `<name>.wav` dropped into the pocket-voices folder becomes a cloned
 *      voice, synthesized fully offline.
 *   2. **Local HTTP service** (advanced, optional): the pocket-tts Python
 *      service adds the built-in Kyutai catalog + keeps the model warm.
 * The backend routing is server-side; this panel just reports both statuses
 * and lists the merged voices.
 */
export default function PocketVoicePanel() {
  const { t } = useTranslation();
  const pocketVoiceId = useSystemStore((s) => s.companionPocketVoiceId);
  const setPocketVoiceId = useSystemStore((s) => s.setCompanionPocketVoiceId);
  const voiceEnabled = useSystemStore((s) => s.companionVoiceEnabled);
  const setVoiceEnabled = useSystemStore((s) => s.setCompanionVoiceEnabled);

  const [status, setStatus] = useState<PocketStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [voices, setVoices] = useState<PocketVoiceEntry[] | null>(null);
  const [voicesError, setVoicesError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setStatusLoading(true);
    setVoicesError(null);
    try {
      const s = await companionTtsPocketStatus();
      setStatus(s);
      const sidecarReady = s.engineInstalled && s.modelInstalled;
      if (s.running || sidecarReady) {
        setVoices(await companionTtsListPocketVoices());
      } else {
        setVoices(null);
      }
    } catch (e: unknown) {
      setVoicesError(e instanceof Error ? e.message : String(e));
      silentCatch('pocket.status')(e);
    } finally {
      setStatusLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const sidecarReady = !!status?.engineInstalled && !!status?.modelInstalled;
  const usable = sidecarReady || !!status?.running;
  const canEnable = usable && !!pocketVoiceId;

  // Cloned voices are the engine's headline — the backend lists them first
  // already; keep its order.
  return (
    <div className="space-y-4 max-w-2xl">
      <SetupCard status={status} loading={statusLoading} onRecheck={refresh} />

      {usable && (
        <SectionCard
          title={t.plugins.companion.voice_pocket_voices_title}
          subtitle={t.plugins.companion.voice_pocket_voices_desc}
          titleClassName="text-primary"
        >
          <div className="px-1 py-2 space-y-2">
            {voicesError && <p className="typo-caption text-status-warning">{voicesError}</p>}
            {voices === null ? (
              <div className="flex items-center gap-2 typo-caption text-foreground">
                <LoadingSpinner size="sm" />
                {t.plugins.companion.loading}
              </div>
            ) : (
              voices.map((v) => (
                <PocketVoiceRow
                  key={v.voiceId}
                  voice={v}
                  selected={pocketVoiceId === v.voiceId}
                  onSelect={() => setPocketVoiceId(v.voiceId)}
                />
              ))
            )}
            {status && (
              <div className="pt-1">
                <div className="typo-caption text-foreground">
                  {t.plugins.companion.voice_pocket_voices_dir_label}
                </div>
                <p className="typo-caption mt-0.5">
                  {t.plugins.companion.voice_pocket_voices_dir_hint}
                </p>
                <div className="flex items-center gap-1.5 mt-1">
                  <code className="flex-1 typo-code text-[11px] text-foreground bg-secondary/40 rounded-input px-2 py-1 break-all">
                    {status.voicesDir}
                  </code>
                  <CopyButton
                    text={status.voicesDir}
                    tooltip={t.plugins.companion.voice_kokoro_copy_path}
                  />
                </div>
              </div>
            )}
          </div>
        </SectionCard>
      )}

      <SectionCard
        title={t.plugins.companion.voice_enable_title}
        subtitle={t.plugins.companion.voice_enable_desc}
        titleClassName="text-primary"
      >
        <SettingRow
          label={t.plugins.companion.voice_enable_label}
          description={
            !canEnable
              ? t.plugins.companion.voice_pocket_enable_blocked
              : voiceEnabled
                ? t.plugins.companion.voice_enable_on
                : t.plugins.companion.voice_enable_off
          }
          checked={voiceEnabled}
          disabled={!canEnable}
          onChange={() => canEnable && setVoiceEnabled(!voiceEnabled)}
        />
      </SectionCard>
    </div>
  );
}

interface SetupCardProps {
  status: PocketStatus | null;
  loading: boolean;
  onRecheck: () => void;
}

function SetupCard({ status, loading, onRecheck }: SetupCardProps) {
  const { t } = useTranslation();
  const sidecarReady = !!status?.engineInstalled && !!status?.modelInstalled;
  const showAutoInstall = !!status?.canAutoInstall && !sidecarReady;

  return (
    <SectionCard
      title={t.plugins.companion.voice_pocket_packaged_title}
      subtitle={t.plugins.companion.voice_pocket_packaged_desc}
      titleClassName="text-primary"
    >
      <div className="px-1 py-2 space-y-3">
        {loading || !status ? (
          <div className="flex items-center gap-2 typo-caption text-foreground">
            <LoadingSpinner size="sm" />
            {t.plugins.companion.loading}
          </div>
        ) : (
          <>
            {showAutoInstall && <InstallBlock onDone={onRecheck} />}
            <SetupRow
              icon={<Cpu className="w-4 h-4" />}
              label={t.plugins.companion.voice_kokoro_engine_label}
              installed={status.engineInstalled}
              installedText={status.expectedBinaryPath}
              hint={t.plugins.companion.voice_pocket_engine_hint}
              pathLabel={t.plugins.companion.voice_kokoro_engine_path_label}
              path={status.expectedBinaryPath}
              url={status.engineDownloadUrl}
            />
            <SetupRow
              icon={<Package className="w-4 h-4" />}
              label={t.plugins.companion.voice_kokoro_model_label}
              installed={status.modelInstalled}
              installedText={status.modelDir}
              hint={t.plugins.companion.voice_pocket_model_hint}
              pathLabel={t.plugins.companion.voice_kokoro_model_path_label}
              path={status.modelDir}
              url={status.modelDownloadUrl}
            />
            <ServiceRow status={status} />
          </>
        )}
        <button
          type="button"
          onClick={onRecheck}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-interactive bg-secondary/40 hover:bg-secondary/60 border border-foreground/10 text-foreground typo-caption transition-colors focus-ring disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          {t.plugins.companion.voice_kokoro_recheck}
        </button>
      </div>
    </SectionCard>
  );
}

/**
 * One-click install — downloads the arch-correct sidecar + int8 model via
 * the backend, streaming progress on `POCKET_INSTALL_EVENT`. Mirrors the
 * Kokoro InstallBlock.
 */
function InstallBlock({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const [installing, setInstalling] = useState(false);
  const [progress, setProgress] = useState<PocketInstallProgress | null>(null);
  const unlistenRef = useRef<UnlistenFn | null>(null);

  useEffect(() => {
    let cancelled = false;
    listen<PocketInstallProgress>(POCKET_INSTALL_EVENT, (evt) => {
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
      .catch(silentCatch('pocket.install.subscribe'));
    return () => {
      cancelled = true;
      unlistenRef.current?.();
      unlistenRef.current = null;
    };
  }, [onDone]);

  const onInstall = useCallback(async () => {
    setInstalling(true);
    setProgress({ phase: 'downloading_engine', bytesDownloaded: 0, bytesTotal: null, error: null });
    try {
      await companionTtsPocketDownload();
    } catch (e) {
      setInstalling(false);
      setProgress({
        phase: 'failed',
        bytesDownloaded: 0,
        bytesTotal: null,
        error: e instanceof Error ? e.message : String(e),
      });
      silentCatch('pocket.install')(e);
    }
  }, []);

  const phaseLabel = (p: PocketInstallProgress['phase']): string => {
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
        <AudioWaveform className="w-4 h-4 text-primary" />
        <span className="typo-title text-primary">
          {t.plugins.companion.voice_pocket_install_title}
        </span>
      </div>
      <p className="typo-caption">{t.plugins.companion.voice_pocket_install_desc}</p>
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
          {t.plugins.companion.voice_pocket_install_button}
        </button>
      )}
      {failed && progress?.error && (
        <p className="typo-caption text-status-warning break-words">{progress.error}</p>
      )}
    </div>
  );
}

/** Optional local-service row — advanced path; adds the built-in catalog. */
function ServiceRow({ status }: { status: PocketStatus }) {
  const { t } = useTranslation();
  const running = status.running;
  return (
    <div className="rounded-card border border-foreground/10 bg-secondary/20 p-3">
      <div className="flex items-center gap-2">
        <span className={running ? 'text-emerald-400' : 'text-foreground'}>
          <FolderOpen className="w-4 h-4" />
        </span>
        <span className="typo-title">{t.plugins.companion.voice_pocket_service_title}</span>
        <span
          className={`ml-auto inline-flex items-center gap-1 typo-caption px-2 py-0.5 rounded-full ${
            running ? 'bg-emerald-500/10 text-emerald-400' : 'bg-foreground/5 text-foreground'
          }`}
        >
          {running && <CheckCircle2 className="w-3 h-3" />}
          {running
            ? t.plugins.companion.voice_pocket_running
            : t.plugins.companion.voice_pocket_not_running}
        </span>
      </div>
      <p className="typo-caption mt-1.5">{t.plugins.companion.voice_pocket_service_desc}</p>
      <div className="flex items-center gap-1.5 mt-1.5">
        <code className="flex-1 typo-code text-[11px] text-foreground bg-secondary/40 rounded-input px-2 py-1 break-all">
          {status.baseUrl}
        </code>
        <CopyButton text={status.baseUrl} tooltip={t.plugins.companion.voice_pocket_url_label} />
      </div>
    </div>
  );
}

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

function SetupRow({ icon, label, installed, installedText, hint, pathLabel, path, url }: SetupRowProps) {
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

interface PocketVoiceRowProps {
  voice: PocketVoiceEntry;
  selected: boolean;
  onSelect: () => void;
}

function PocketVoiceRow({ voice, selected, onSelect }: PocketVoiceRowProps) {
  const { t } = useTranslation();
  const settings = useTtsSettings();
  const [previewState, setPreviewState] = useState<'idle' | 'synth' | 'playing'>('idle');
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
        voice.voiceId,
        settings,
        'pocket_tts',
      );
      urlRef.current = url;
      const { audio, done } = play(url);
      audioRef.current = audio;
      setPreviewState('playing');
      await done.catch(silentCatch('pocket.preview.play'));
      cleanup();
      setPreviewState('idle');
    } catch (e) {
      silentCatch('pocket.preview.synth')(e);
      cleanup();
      setPreviewState('idle');
    }
  }, [previewState, cleanup, t, voice.voiceId, settings]);

  const isCloned = voice.category === 'cloned';

  return (
    <div
      className={`rounded-card border p-3 ${
        selected ? 'border-cyan-500/40 bg-cyan-500/5' : 'border-foreground/10 bg-secondary/20'
      }`}
    >
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="typo-title">{voice.name}</span>
            {isCloned && (
              <span className="inline-flex items-center gap-1 typo-caption px-2 py-0.5 rounded-full bg-primary/15 text-primary">
                <AudioWaveform className="w-3 h-3" />
                {t.plugins.companion.voice_pocket_cloned_badge}
              </span>
            )}
            {selected && (
              <span className="inline-flex items-center gap-1 typo-caption px-2 py-0.5 rounded-full bg-cyan-500/15 text-cyan-300">
                <CheckCircle2 className="w-3 h-3" />
                {t.plugins.companion.voice_piper_voice_selected}
              </span>
            )}
          </div>
        </div>
        <div className="flex gap-1.5 shrink-0">
          <button
            type="button"
            onClick={onSelect}
            disabled={selected}
            className="inline-flex items-center gap-1 px-3 py-1 rounded-interactive bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-200 typo-caption font-medium transition-colors focus-ring disabled:opacity-40"
          >
            <CheckCircle2 className="w-3 h-3" />
            {selected
              ? t.plugins.companion.voice_piper_voice_selected
              : t.plugins.companion.voice_piper_voice_select}
          </button>
          <button
            type="button"
            onClick={onPreview}
            title={t.plugins.companion.voice_kokoro_preview}
            className="inline-flex items-center gap-1 px-3 py-1 rounded-interactive bg-secondary/40 hover:bg-secondary/60 border border-foreground/10 text-foreground typo-caption transition-colors focus-ring"
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
        </div>
      </div>
    </div>
  );
}
