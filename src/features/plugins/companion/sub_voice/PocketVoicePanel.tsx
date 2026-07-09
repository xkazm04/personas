import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AudioWaveform,
  CheckCircle2,
  Loader2,
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
  companionTtsListPocketVoices,
  companionTtsPocketStatus,
  type PocketStatus,
  type PocketVoiceEntry,
} from '@/api/companion';
import { synthesize, play } from '../voicePlayback';
import { useTtsSettings } from '../useTtsSettings';

/**
 * Pocket TTS voice picker. Local engine backed by a long-lived HTTP sidecar
 * service (kyutai pocket-tts) — the only local engine with zero-shot voice
 * cloning. Unlike Piper/Kokoro there is nothing to download through the app:
 * the user runs the service once, and any `.safetensors` voice embedding in
 * the service's voices folder shows up here as a selectable "cloned" voice
 * next to the built-in Kyutai catalog.
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
      if (s.running) {
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

  const running = !!status?.running;
  const canEnable = running && !!pocketVoiceId;

  // Cloned voices are the engine's headline — list them first.
  const sorted = voices
    ? [...voices].sort((a, b) =>
        a.category === b.category ? a.name.localeCompare(b.name) : a.category === 'cloned' ? -1 : 1,
      )
    : null;

  return (
    <div className="space-y-4 max-w-2xl">
      <ServiceCard status={status} loading={statusLoading} onRecheck={refresh} />

      {running && (
        <SectionCard
          title={t.plugins.companion.voice_pocket_voices_title}
          subtitle={t.plugins.companion.voice_pocket_voices_desc}
          titleClassName="text-primary"
        >
          <div className="px-1 py-2 space-y-2">
            {voicesError && <p className="typo-caption text-status-warning">{voicesError}</p>}
            {sorted === null ? (
              <div className="flex items-center gap-2 typo-caption text-foreground">
                <LoadingSpinner size="sm" />
                {t.plugins.companion.loading}
              </div>
            ) : (
              sorted.map((v) => (
                <PocketVoiceRow
                  key={v.voiceId}
                  voice={v}
                  selected={pocketVoiceId === v.voiceId}
                  onSelect={() => setPocketVoiceId(v.voiceId)}
                />
              ))
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

interface ServiceCardProps {
  status: PocketStatus | null;
  loading: boolean;
  onRecheck: () => void;
}

function ServiceCard({ status, loading, onRecheck }: ServiceCardProps) {
  const { t } = useTranslation();
  const running = !!status?.running;

  return (
    <SectionCard
      title={t.plugins.companion.voice_pocket_setup_title}
      subtitle={t.plugins.companion.voice_pocket_setup_desc}
      titleClassName="text-primary"
    >
      <div className="px-1 py-2 space-y-3">
        {loading || !status ? (
          <div className="flex items-center gap-2 typo-caption text-foreground">
            <LoadingSpinner size="sm" />
            {t.plugins.companion.loading}
          </div>
        ) : (
          <div className="rounded-card border border-foreground/10 bg-secondary/20 p-3">
            <div className="flex items-center gap-2">
              <span className={running ? 'text-emerald-400' : 'text-foreground'}>
                <AudioWaveform className="w-4 h-4" />
              </span>
              <span className="typo-title">{t.plugins.companion.voice_pocket_setup_title}</span>
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
            {!running && (
              <p className="typo-caption mt-2">
                {t.plugins.companion.voice_pocket_not_running_hint}
              </p>
            )}
            <div className="mt-2">
              <div className="typo-caption text-foreground">
                {t.plugins.companion.voice_pocket_url_label}
              </div>
              <div className="flex items-center gap-1.5 mt-1">
                <code className="flex-1 typo-code text-[11px] text-foreground bg-secondary/40 rounded-input px-2 py-1 break-all">
                  {status.baseUrl}
                </code>
                <CopyButton
                  text={status.baseUrl}
                  tooltip={t.plugins.companion.voice_pocket_url_label}
                />
              </div>
            </div>
          </div>
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
