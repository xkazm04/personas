import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import {
  CheckCircle2,
  Cpu,
  Download,
  Loader2,
  RefreshCw,
  Trash2,
  XCircle,
} from 'lucide-react';
import { SectionCard } from '@/features/shared/components/layout/SectionCard';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';
import { silentCatch } from '@/lib/silentCatch';
import {
  TTS_DOWNLOAD_EVENT,
  companionTtsDeletePiperVoice,
  companionTtsDownloadPiperVoice,
  companionTtsListPiperVoices,
  companionTtsPiperEngineStatus,
  type PiperEngineStatus,
  type PiperVoiceListing,
  type TtsDownloadProgress,
} from '@/api/companion';

/**
 * Piper voice picker. Two cards stacked:
 *
 *   1. Engine status — Installed / Not installed badge plus the install
 *      path so the user can drop `piper(.exe)` into the right place.
 *      Polls re-check on demand because the install is filesystem-only
 *      (no app restart required).
 *
 *   2. Voice catalog — curated voices grouped by language. Each row
 *      shows speaker / quality / size and a Download → Select progression.
 *      Active downloads stream progress through the
 *      `companion://tts-download` event channel and we mirror that
 *      into per-voice progress bars.
 */
export default function PiperVoicePanel() {
  const { t } = useTranslation();

  const piperVoiceId = useSystemStore((s) => s.companionPiperVoiceId);
  const setPiperVoiceId = useSystemStore((s) => s.setCompanionPiperVoiceId);
  const voiceEnabled = useSystemStore((s) => s.companionVoiceEnabled);
  const setVoiceEnabled = useSystemStore((s) => s.setCompanionVoiceEnabled);

  const [voices, setVoices] = useState<PiperVoiceListing[] | null>(null);
  const [voicesLoading, setVoicesLoading] = useState(true);
  const [voicesError, setVoicesError] = useState<string | null>(null);
  const [engine, setEngine] = useState<PiperEngineStatus | null>(null);
  const [engineLoading, setEngineLoading] = useState(true);
  const [progress, setProgress] = useState<Record<string, TtsDownloadProgress>>({});

  const refreshVoices = useCallback(async () => {
    setVoicesLoading(true);
    setVoicesError(null);
    try {
      const list = await companionTtsListPiperVoices();
      setVoices(list);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setVoicesError(msg);
    } finally {
      setVoicesLoading(false);
    }
  }, []);

  const refreshEngine = useCallback(async () => {
    setEngineLoading(true);
    try {
      const s = await companionTtsPiperEngineStatus();
      setEngine(s);
    } catch (e) {
      silentCatch('piper.engine_status')(e);
    } finally {
      setEngineLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshVoices();
    void refreshEngine();
  }, [refreshVoices, refreshEngine]);

  // Subscribe once to the download event channel and route by voice id.
  // We unmount-clean via the returned unlisten — Tauri's event API
  // requires cleanup or the listener leaks across HMR cycles.
  const unlistenRef = useRef<UnlistenFn | null>(null);
  useEffect(() => {
    let cancelled = false;
    listen<TtsDownloadProgress>(TTS_DOWNLOAD_EVENT, (evt) => {
      if (cancelled) return;
      setProgress((prev) => ({ ...prev, [evt.payload.voiceId]: evt.payload }));
      if (evt.payload.state === 'completed') {
        // Refresh the catalog so `isDownloaded` flips on the row.
        void refreshVoices();
      }
    })
      .then((unlisten) => {
        if (cancelled) {
          unlisten();
        } else {
          unlistenRef.current = unlisten;
        }
      })
      .catch(silentCatch('piper.subscribe'));
    return () => {
      cancelled = true;
      const u = unlistenRef.current;
      if (u) u();
      unlistenRef.current = null;
    };
  }, [refreshVoices]);

  const onDownload = useCallback(
    async (voiceId: string) => {
      // Optimistic: stamp a queued state so the row flips into the
      // downloading affordance immediately even before the first event.
      setProgress((p) => ({
        ...p,
        [voiceId]: {
          voiceId,
          state: 'queued',
          bytesDownloaded: 0,
          bytesTotal: null,
          error: null,
        },
      }));
      try {
        await companionTtsDownloadPiperVoice(voiceId);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        setProgress((p) => ({
          ...p,
          [voiceId]: {
            voiceId,
            state: 'failed',
            bytesDownloaded: 0,
            bytesTotal: null,
            error: msg,
          },
        }));
      }
    },
    [],
  );

  const onDelete = useCallback(
    async (voiceId: string) => {
      try {
        await companionTtsDeletePiperVoice(voiceId);
        if (piperVoiceId === voiceId) {
          setPiperVoiceId(null);
          if (voiceEnabled) setVoiceEnabled(false);
        }
        setProgress((p) => {
          const next = { ...p };
          delete next[voiceId];
          return next;
        });
        await refreshVoices();
      } catch (e) {
        silentCatch('piper.delete')(e);
      }
    },
    [piperVoiceId, setPiperVoiceId, voiceEnabled, setVoiceEnabled, refreshVoices],
  );

  // Group voices by language for the catalog rendering. Order matches
  // the catalog order (English first, then alpha). `Map` preserves
  // insertion order in JS so the natural traversal is correct.
  const groupedVoices = useMemo(() => {
    const groups = new Map<string, { label: string; native: string; voices: PiperVoiceListing[] }>();
    if (!voices) return groups;
    for (const v of voices) {
      const existing = groups.get(v.languageCode);
      if (existing) {
        existing.voices.push(v);
      } else {
        groups.set(v.languageCode, {
          label: v.languageLabel,
          native: v.languageNativeLabel,
          voices: [v],
        });
      }
    }
    return groups;
  }, [voices]);

  return (
    <div className="space-y-4 max-w-2xl">
      <EngineStatusCard
        engine={engine}
        loading={engineLoading}
        onRecheck={refreshEngine}
      />

      <SectionCard
        title={t.plugins.companion.voice_piper_voices_title}
        subtitle={t.plugins.companion.voice_piper_voices_desc}
      >
        <div className="px-1 py-2 space-y-3">
          {voicesLoading && voices === null ? (
            <div className="flex items-center gap-3 typo-caption text-foreground/60">
              <LoadingSpinner size="sm" />
              <span>{t.plugins.companion.loading}</span>
            </div>
          ) : voicesError ? (
            <p className="typo-caption text-status-warning">{voicesError}</p>
          ) : (
            Array.from(groupedVoices.entries()).map(([code, group]) => (
              <LanguageGroup
                key={code}
                label={group.label}
                native={group.native}
                voices={group.voices}
                selectedVoiceId={piperVoiceId}
                progress={progress}
                onDownload={onDownload}
                onDelete={onDelete}
                onSelect={(id) => setPiperVoiceId(id)}
                t={t}
              />
            ))
          )}
        </div>
      </SectionCard>
    </div>
  );
}

interface EngineStatusCardProps {
  engine: PiperEngineStatus | null;
  loading: boolean;
  onRecheck: () => void;
}

function EngineStatusCard({ engine, loading, onRecheck }: EngineStatusCardProps) {
  const { t } = useTranslation();
  const installed = engine?.installed ?? false;
  return (
    <SectionCard
      title={t.plugins.companion.voice_piper_engine_status_title}
      subtitle={t.plugins.companion.voice_piper_engine_status_desc}
    >
      <div className="px-1 py-2 space-y-3">
        <div className="flex items-center gap-3">
          <Cpu
            className={`w-5 h-5 shrink-0 ${installed ? 'text-emerald-400' : 'text-foreground/40'}`}
          />
          <div className="flex-1 min-w-0">
            <div className="typo-body font-medium">
              {installed
                ? t.plugins.companion.voice_piper_engine_installed
                : t.plugins.companion.voice_piper_engine_not_installed}
            </div>
            {installed && engine?.binaryPath && (
              <div
                className="typo-code text-[11px] text-foreground/60 mt-0.5 truncate"
                title={engine.binaryPath}
              >
                {engine.binaryPath}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={onRecheck}
            disabled={loading}
            className="p-2 rounded-interactive bg-secondary/40 hover:bg-secondary/60 border border-foreground/10 text-foreground/70 hover:text-foreground transition-colors focus-ring disabled:opacity-50"
            title={t.plugins.companion.voice_piper_engine_recheck}
            aria-label={t.plugins.companion.voice_piper_engine_recheck}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
        {!installed && engine && (
          <div className="rounded-card border border-amber-500/30 bg-amber-500/5 p-3 space-y-2">
            <p className="typo-caption text-foreground/70">
              {t.plugins.companion.voice_piper_engine_install_hint_release}
            </p>
            <div>
              <div className="typo-caption text-foreground/60">
                {t.plugins.companion.voice_piper_engine_install_hint_path_label}
              </div>
              <code className="block typo-code text-[11px] text-foreground/80 bg-secondary/40 rounded-input px-2 py-1 mt-1 break-all">
                {engine.expectedPath}
              </code>
            </div>
          </div>
        )}
      </div>
    </SectionCard>
  );
}

interface LanguageGroupProps {
  label: string;
  native: string;
  voices: PiperVoiceListing[];
  selectedVoiceId: string | null;
  progress: Record<string, TtsDownloadProgress>;
  onDownload: (voiceId: string) => void;
  onDelete: (voiceId: string) => void;
  onSelect: (voiceId: string) => void;
  t: ReturnType<typeof useTranslation>['t'];
}

function LanguageGroup(props: LanguageGroupProps) {
  const { label, native, voices, selectedVoiceId, progress, onDownload, onDelete, onSelect, t } = props;
  return (
    <div className="space-y-2">
      <div className="flex items-baseline gap-2">
        <span className="typo-caption font-semibold text-foreground/80">{label}</span>
        {native && native !== label && (
          <span className="typo-caption text-foreground/50">· {native}</span>
        )}
      </div>
      <div className="space-y-1.5">
        {voices.map((v) => (
          <VoiceRow
            key={v.voiceId}
            voice={v}
            selected={selectedVoiceId === v.voiceId}
            progress={progress[v.voiceId]}
            onDownload={() => onDownload(v.voiceId)}
            onDelete={() => onDelete(v.voiceId)}
            onSelect={() => onSelect(v.voiceId)}
            t={t}
          />
        ))}
      </div>
    </div>
  );
}

interface VoiceRowProps {
  voice: PiperVoiceListing;
  selected: boolean;
  progress?: TtsDownloadProgress;
  onDownload: () => void;
  onDelete: () => void;
  onSelect: () => void;
  t: ReturnType<typeof useTranslation>['t'];
}

function VoiceRow({ voice, selected, progress, onDownload, onDelete, onSelect, t }: VoiceRowProps) {
  // Derive the visible state from a precedence ladder so a stale local
  // progress entry from a failed earlier attempt never overrides a
  // freshly-downloaded `isDownloaded: true` from the catalog refresh.
  const downloading =
    progress?.state === 'queued' || progress?.state === 'downloading';
  const failed = progress?.state === 'failed';
  const downloaded = voice.isDownloaded;

  const qualityLabel: Record<PiperVoiceListing['quality'], string> = {
    x_low: t.plugins.companion.voice_piper_voice_quality_x_low,
    low: t.plugins.companion.voice_piper_voice_quality_low,
    medium: t.plugins.companion.voice_piper_voice_quality_medium,
    high: t.plugins.companion.voice_piper_voice_quality_high,
  };
  const genderLabel: Record<PiperVoiceListing['gender'], string> = {
    female: t.plugins.companion.voice_piper_voice_gender_female,
    male: t.plugins.companion.voice_piper_voice_gender_male,
    neutral: t.plugins.companion.voice_piper_voice_gender_neutral,
  };

  return (
    <div
      className={`rounded-card border p-3 ${
        selected
          ? 'border-cyan-500/40 bg-cyan-500/5'
          : 'border-foreground/10 bg-secondary/20'
      }`}
    >
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="typo-body font-medium">{voice.speaker}</span>
            <span className="typo-caption text-foreground/60">
              · {genderLabel[voice.gender]} · {qualityLabel[voice.quality]} · {voice.approxSizeMb} MB
            </span>
            {selected && (
              <span className="inline-flex items-center gap-1 typo-caption px-2 py-0.5 rounded-full bg-cyan-500/15 text-cyan-300">
                <CheckCircle2 className="w-3 h-3" />
                {t.plugins.companion.voice_piper_voice_selected}
              </span>
            )}
          </div>
          <p className="typo-caption text-foreground/60 mt-0.5">{voice.description}</p>
          {downloading && (
            <DownloadProgressBar progress={progress!} />
          )}
          {failed && (
            <p className="typo-caption text-status-warning mt-1">
              <XCircle className="inline w-3 h-3 mr-1" />
              {progress?.error ?? ''}
            </p>
          )}
        </div>
        <div className="flex flex-col gap-1.5 shrink-0">
          {downloaded && !downloading ? (
            <>
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
                onClick={onDelete}
                className="inline-flex items-center gap-1 px-3 py-1 rounded-interactive bg-secondary/40 hover:bg-status-warning/20 text-foreground/60 hover:text-status-warning typo-caption transition-colors focus-ring"
                title={t.plugins.companion.voice_piper_voice_delete}
              >
                <Trash2 className="w-3 h-3" />
                {t.plugins.companion.voice_piper_voice_delete}
              </button>
            </>
          ) : downloading ? (
            <button
              type="button"
              disabled
              className="inline-flex items-center gap-1 px-3 py-1 rounded-interactive bg-secondary/40 text-foreground/60 typo-caption opacity-70"
            >
              <Loader2 className="w-3 h-3 animate-spin" />
              {t.plugins.companion.voice_piper_voice_downloading}
            </button>
          ) : (
            <button
              type="button"
              onClick={onDownload}
              className="inline-flex items-center gap-1 px-3 py-1 rounded-interactive bg-primary/15 hover:bg-primary/25 text-primary typo-caption font-medium transition-colors focus-ring"
            >
              <Download className="w-3 h-3" />
              {failed
                ? t.plugins.companion.voice_piper_voice_redownload
                : t.plugins.companion.voice_piper_voice_download}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function DownloadProgressBar({ progress }: { progress: TtsDownloadProgress }) {
  const total = progress.bytesTotal ?? 0;
  const pct =
    total > 0 ? Math.min(100, Math.round((progress.bytesDownloaded / total) * 100)) : null;
  const mbDownloaded = (progress.bytesDownloaded / (1024 * 1024)).toFixed(1);
  const mbTotal = total > 0 ? (total / (1024 * 1024)).toFixed(1) : null;
  return (
    <div className="mt-2 space-y-1">
      <div className="h-1 rounded-full bg-secondary/60 overflow-hidden">
        <div
          className={`h-full bg-primary transition-[width] ${pct === null ? 'animate-pulse w-1/3' : ''}`}
          style={pct !== null ? { width: `${pct}%` } : undefined}
        />
      </div>
      <div className="typo-caption text-foreground/50 text-[11px]">
        {pct !== null ? `${pct}% — ` : ''}
        {mbDownloaded} MB{mbTotal ? ` / ${mbTotal} MB` : ''}
      </div>
    </div>
  );
}
