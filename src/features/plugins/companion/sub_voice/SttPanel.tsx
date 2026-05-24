import { useCallback, useEffect, useRef, useState } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import {
  CheckCircle2,
  Cloud,
  Cpu,
  Download,
  HardDrive,
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
  STT_DOWNLOAD_EVENT,
  companionSttDeleteModel,
  companionSttDownloadModel,
  companionSttEngineStatus,
  companionSttListModels,
  type SttDownloadProgress,
  type SttEngineStatus,
  type WhisperModelListing,
} from '@/api/companion';

/**
 * Voice-input (speech-to-text) configuration. Lives at the bottom of the
 * Voice tab below the TTS panels. Two engines:
 *
 *   - Browser (Web Speech) — zero setup; on WebView2 the audio is sent to
 *     the OS vendor's cloud STT (disclosed in the UI).
 *   - Local Whisper — on-device via a sidecar binary + a downloaded ggml
 *     model. Mirrors the Piper engine-status + model-browser pattern.
 */
export default function SttPanel() {
  const { t } = useTranslation();
  const engine = useSystemStore((s) => s.companionSttEngine);
  const setEngine = useSystemStore((s) => s.setCompanionSttEngine);

  return (
    <div className="space-y-4">
      <SectionCard
        title={t.plugins.companion.stt_title}
        subtitle={t.plugins.companion.stt_desc}
        titleClassName="text-primary"
      >
        <div className="grid grid-cols-2 gap-2 px-1 py-2">
          <EngineButton
            active={engine === 'browser'}
            onClick={() => setEngine('browser')}
            icon={<Cloud className="w-4 h-4" />}
            label={t.plugins.companion.stt_engine_browser}
            caption={t.plugins.companion.stt_engine_browser_caption}
          />
          <EngineButton
            active={engine === 'whisper'}
            onClick={() => setEngine('whisper')}
            icon={<HardDrive className="w-4 h-4" />}
            label={t.plugins.companion.stt_engine_whisper}
            caption={t.plugins.companion.stt_engine_whisper_caption}
          />
        </div>
        {engine === 'browser' && (
          <div className="mx-1 mb-2 rounded-card border border-amber-500/30 bg-amber-500/5 px-3 py-2">
            <p className="typo-caption text-amber-300/90">
              {t.plugins.companion.stt_browser_disclosure}
            </p>
          </div>
        )}
      </SectionCard>

      {engine === 'whisper' && <WhisperConfig />}
    </div>
  );
}

interface EngineButtonProps {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  caption: string;
}

function EngineButton({ active, onClick, icon, label, caption }: EngineButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`text-left rounded-card border p-3 transition-colors focus-ring ${
        active
          ? 'border-cyan-500/50 bg-cyan-500/10'
          : 'border-foreground/10 bg-secondary/20 hover:bg-secondary/40'
      }`}
    >
      <div className="flex items-center gap-2">
        <span className={active ? 'text-cyan-300' : 'text-foreground'}>{icon}</span>
        <span className={`typo-body font-medium ${active ? 'text-cyan-200' : 'text-foreground'}`}>
          {label}
        </span>
      </div>
      <p className="typo-caption text-foreground mt-1">{caption}</p>
    </button>
  );
}

function WhisperConfig() {
  const { t } = useTranslation();
  const modelId = useSystemStore((s) => s.companionSttModelId);
  const setModelId = useSystemStore((s) => s.setCompanionSttModelId);

  const [models, setModels] = useState<WhisperModelListing[] | null>(null);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [status, setStatus] = useState<SttEngineStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [progress, setProgress] = useState<Record<string, SttDownloadProgress>>({});

  const refreshModels = useCallback(async () => {
    setModelsError(null);
    try {
      setModels(await companionSttListModels());
    } catch (e: unknown) {
      setModelsError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const refreshStatus = useCallback(async () => {
    setStatusLoading(true);
    try {
      setStatus(await companionSttEngineStatus());
    } catch (e) {
      silentCatch('stt.engine_status')(e);
    } finally {
      setStatusLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshModels();
    void refreshStatus();
  }, [refreshModels, refreshStatus]);

  const unlistenRef = useRef<UnlistenFn | null>(null);
  useEffect(() => {
    let cancelled = false;
    listen<SttDownloadProgress>(STT_DOWNLOAD_EVENT, (evt) => {
      if (cancelled) return;
      setProgress((prev) => ({ ...prev, [evt.payload.modelId]: evt.payload }));
      if (evt.payload.state === 'completed') void refreshModels();
    })
      .then((unlisten) => {
        if (cancelled) unlisten();
        else unlistenRef.current = unlisten;
      })
      .catch(silentCatch('stt.subscribe'));
    return () => {
      cancelled = true;
      unlistenRef.current?.();
      unlistenRef.current = null;
    };
  }, [refreshModels]);

  const onDownload = useCallback(async (id: string) => {
    setProgress((p) => ({
      ...p,
      [id]: { modelId: id, state: 'queued', bytesDownloaded: 0, bytesTotal: null, error: null },
    }));
    try {
      await companionSttDownloadModel(id);
    } catch (e) {
      silentCatch('stt.download')(e);
    }
  }, []);

  const onDelete = useCallback(
    async (id: string) => {
      try {
        await companionSttDeleteModel(id);
        if (modelId === id) setModelId(null);
        await refreshModels();
      } catch (e) {
        silentCatch('stt.delete')(e);
      }
    },
    [modelId, setModelId, refreshModels],
  );

  return (
    <>
      <SectionCard
        title={t.plugins.companion.stt_engine_status_title}
        subtitle={t.plugins.companion.stt_engine_status_desc}
        titleClassName="text-primary"
      >
        <div className="px-1 py-2">
          {statusLoading ? (
            <div className="flex items-center gap-2 typo-caption text-foreground">
              <LoadingSpinner size="sm" />
              {t.plugins.companion.stt_loading}
            </div>
          ) : (
            <div className="flex items-start gap-3">
              <Cpu
                className={`w-4 h-4 mt-0.5 shrink-0 ${status?.installed ? 'text-emerald-400' : 'text-foreground'}`}
              />
              <div className="flex-1 min-w-0">
                <div className="typo-body font-medium">
                  {status?.installed
                    ? t.plugins.companion.stt_installed
                    : t.plugins.companion.stt_not_installed}
                </div>
                {!status?.installed && (
                  <p className="typo-caption text-foreground mt-1">
                    {t.plugins.companion.stt_install_hint}
                  </p>
                )}
                {status && (
                  <p className="typo-code text-[11px] text-foreground mt-1 break-all">
                    {status.installed ? status.binaryPath : status.expectedPath}
                  </p>
                )}
              </div>
              <button
                onClick={() => void refreshStatus()}
                className="p-2 rounded-interactive bg-secondary/40 hover:bg-secondary/60 border border-foreground/10 text-foreground transition-colors focus-ring shrink-0"
                title={t.plugins.companion.stt_refresh}
                aria-label={t.plugins.companion.stt_refresh}
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
      </SectionCard>

      <SectionCard
        title={t.plugins.companion.stt_models_title}
        subtitle={t.plugins.companion.stt_models_desc}
        titleClassName="text-primary"
      >
        <div className="px-1 py-2 space-y-2">
          {modelsError && (
            <p className="typo-caption text-status-warning">{modelsError}</p>
          )}
          {models === null ? (
            <div className="flex items-center gap-2 typo-caption text-foreground">
              <LoadingSpinner size="sm" />
              {t.plugins.companion.stt_loading}
            </div>
          ) : (
            models.map((m) => {
              const prog = progress[m.modelId];
              const downloading =
                prog?.state === 'queued' || prog?.state === 'downloading';
              const failed = prog?.state === 'failed';
              const selected = modelId === m.modelId;
              const pct =
                prog?.bytesTotal && prog.bytesTotal > 0
                  ? Math.round((prog.bytesDownloaded / prog.bytesTotal) * 100)
                  : null;
              return (
                <div
                  key={m.modelId}
                  className={`rounded-card border p-3 ${
                    selected ? 'border-cyan-500/50 bg-cyan-500/5' : 'border-foreground/10'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="typo-body font-medium truncate">{m.label}</span>
                        <span className="typo-caption text-foreground">{m.approxSizeMb} MB</span>
                        {selected && (
                          <span className="inline-flex items-center gap-1 typo-caption px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-300">
                            <CheckCircle2 className="w-3 h-3" />
                            {t.plugins.companion.stt_model_selected}
                          </span>
                        )}
                      </div>
                      <p className="typo-caption text-foreground mt-0.5">{m.description}</p>
                    </div>
                    <div className="shrink-0 flex items-center gap-1.5">
                      {m.isDownloaded ? (
                        <>
                          <button
                            onClick={() => setModelId(m.modelId)}
                            disabled={selected}
                            className="px-2.5 py-1.5 rounded-interactive typo-caption font-medium bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-300 transition-colors focus-ring disabled:opacity-40"
                          >
                            {selected
                              ? t.plugins.companion.stt_model_selected
                              : t.plugins.companion.stt_model_select}
                          </button>
                          <button
                            onClick={() => void onDelete(m.modelId)}
                            className="p-1.5 rounded-interactive text-foreground hover:text-rose-300 hover:bg-rose-500/10 transition-colors focus-ring"
                            title={t.plugins.companion.stt_model_delete}
                            aria-label={t.plugins.companion.stt_model_delete}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </>
                      ) : downloading ? (
                        <span className="inline-flex items-center gap-1.5 typo-caption text-foreground">
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          {pct != null ? `${pct}%` : t.plugins.companion.stt_model_downloading}
                        </span>
                      ) : (
                        <button
                          onClick={() => void onDownload(m.modelId)}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-interactive typo-caption font-medium bg-secondary/50 hover:bg-secondary/70 border border-foreground/10 text-foreground transition-colors focus-ring"
                        >
                          {failed ? <XCircle className="w-3.5 h-3.5 text-rose-400" /> : <Download className="w-3.5 h-3.5" />}
                          {failed
                            ? t.plugins.companion.stt_model_failed
                            : t.plugins.companion.stt_model_download}
                        </button>
                      )}
                    </div>
                  </div>
                  {downloading && pct != null && (
                    <div className="mt-2 h-1 rounded-full bg-foreground/10 overflow-hidden">
                      <div
                        className="h-full bg-cyan-400 transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </SectionCard>
    </>
  );
}
