import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CheckCircle2,
  Cpu,
  ExternalLink,
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
import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';
import { silentCatch } from '@/lib/silentCatch';
import {
  companionTtsKokoroStatus,
  companionTtsListKokoroVoices,
  type KokoroStatus,
  type KokoroVoiceEntry,
} from '@/api/companion';
import { synthesize, play } from '../voicePlayback';
import { useTtsSettings } from '../useTtsSettings';

/**
 * Kokoro voice picker. Higher-quality local TTS via the sherpa-onnx sidecar.
 *
 * Two-part setup (mirrors Piper's "drop the binary in" model, but the model
 * is a single monolithic package rather than per-voice files):
 *   1. Engine binary — `sherpa-onnx-offline-tts` in the shared bin dir.
 *   2. Model package — the Kokoro `model.onnx` + `voices.bin` + `tokens.txt`
 *      + `espeak-ng-data/`, extracted into `~/.personas/companion-tts/kokoro/`.
 *
 * Once both are present the curated voices become selectable + previewable
 * (a ▶ button synthesizes a sample line through the same `companion_tts`
 * path Athena's replies use, so what you hear is what you'll get).
 */
export default function KokoroVoicePanel() {
  const { t } = useTranslation();
  const kokoroVoiceId = useSystemStore((s) => s.companionKokoroVoiceId);
  const setKokoroVoiceId = useSystemStore((s) => s.setCompanionKokoroVoiceId);
  const voiceEnabled = useSystemStore((s) => s.companionVoiceEnabled);
  const setVoiceEnabled = useSystemStore((s) => s.setCompanionVoiceEnabled);

  const [status, setStatus] = useState<KokoroStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [voices, setVoices] = useState<KokoroVoiceEntry[] | null>(null);
  const [voicesError, setVoicesError] = useState<string | null>(null);

  const refreshStatus = useCallback(async () => {
    setStatusLoading(true);
    try {
      setStatus(await companionTtsKokoroStatus());
    } catch (e) {
      silentCatch('kokoro.status')(e);
    } finally {
      setStatusLoading(false);
    }
  }, []);

  const refreshVoices = useCallback(async () => {
    setVoicesError(null);
    try {
      setVoices(await companionTtsListKokoroVoices());
    } catch (e: unknown) {
      setVoicesError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
    void refreshVoices();
  }, [refreshStatus, refreshVoices]);

  const ready = !!status?.engineInstalled && !!status?.modelInstalled;
  const canEnable = ready && !!kokoroVoiceId;

  return (
    <div className="space-y-4 max-w-2xl">
      <SetupCard status={status} loading={statusLoading} onRecheck={refreshStatus} />

      <SectionCard
        title={t.plugins.companion.voice_kokoro_voices_title}
        subtitle={t.plugins.companion.voice_kokoro_voices_desc}
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
              <KokoroVoiceRow
                key={v.voiceId}
                voice={v}
                selected={kokoroVoiceId === v.voiceId}
                previewable={ready}
                onSelect={() => setKokoroVoiceId(v.voiceId)}
              />
            ))
          )}
        </div>
      </SectionCard>

      <SectionCard
        title={t.plugins.companion.voice_enable_title}
        subtitle={t.plugins.companion.voice_enable_desc}
        titleClassName="text-primary"
      >
        <SettingRow
          label={t.plugins.companion.voice_enable_label}
          description={
            !canEnable
              ? t.plugins.companion.voice_kokoro_enable_blocked
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
  status: KokoroStatus | null;
  loading: boolean;
  onRecheck: () => void;
}

function SetupCard({ status, loading, onRecheck }: SetupCardProps) {
  const { t } = useTranslation();
  return (
    <SectionCard
      title={t.plugins.companion.voice_kokoro_setup_title}
      subtitle={t.plugins.companion.voice_kokoro_setup_desc}
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
            <SetupRow
              icon={<Cpu className="w-4 h-4" />}
              label={t.plugins.companion.voice_kokoro_engine_label}
              installed={status.engineInstalled}
              installedText={status.engineBinaryPath ?? ''}
              hint={t.plugins.companion.voice_kokoro_engine_hint}
              pathLabel={t.plugins.companion.voice_kokoro_engine_path_label}
              path={status.expectedBinaryPath}
              url={status.engineDownloadUrl}
            />
            <SetupRow
              icon={<Package className="w-4 h-4" />}
              label={t.plugins.companion.voice_kokoro_model_label}
              installed={status.modelInstalled}
              installedText={status.modelDir}
              hint={t.plugins.companion.voice_kokoro_model_hint}
              pathLabel={t.plugins.companion.voice_kokoro_model_path_label}
              path={status.modelDir}
              url={status.modelDownloadUrl}
            />
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

interface KokoroVoiceRowProps {
  voice: KokoroVoiceEntry;
  selected: boolean;
  previewable: boolean;
  onSelect: () => void;
}

function KokoroVoiceRow({ voice, selected, previewable, onSelect }: KokoroVoiceRowProps) {
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
        'kokoro',
      );
      urlRef.current = url;
      const { audio, done } = play(url);
      audioRef.current = audio;
      setPreviewState('playing');
      await done.catch(silentCatch('kokoro.preview.play'));
      cleanup();
      setPreviewState('idle');
    } catch (e) {
      silentCatch('kokoro.preview.synth')(e);
      cleanup();
      setPreviewState('idle');
    }
  }, [previewState, cleanup, t, voice.voiceId, settings]);

  const genderLabel =
    voice.gender === 'female'
      ? t.plugins.companion.voice_piper_voice_gender_female
      : t.plugins.companion.voice_piper_voice_gender_male;

  return (
    <div
      className={`rounded-card border p-3 ${
        selected ? 'border-cyan-500/40 bg-cyan-500/5' : 'border-foreground/10 bg-secondary/20'
      }`}
    >
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="typo-title">{voice.speaker}</span>
            <span className="typo-caption">
              · {genderLabel} · {voice.languageLabel} · {voice.grade}
            </span>
            {selected && (
              <span className="inline-flex items-center gap-1 typo-caption px-2 py-0.5 rounded-full bg-cyan-500/15 text-cyan-300">
                <CheckCircle2 className="w-3 h-3" />
                {t.plugins.companion.voice_piper_voice_selected}
              </span>
            )}
          </div>
          <p className="typo-caption mt-0.5">{voice.description}</p>
        </div>
        <div className="flex flex-col gap-1.5 shrink-0">
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
            disabled={!previewable}
            title={
              previewable
                ? t.plugins.companion.voice_kokoro_preview
                : t.plugins.companion.voice_kokoro_preview_blocked
            }
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
        </div>
      </div>
    </div>
  );
}
