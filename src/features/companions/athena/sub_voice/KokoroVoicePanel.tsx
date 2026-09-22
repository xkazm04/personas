import { useCallback, useEffect, useState } from 'react';
import {
  CheckCircle2,
  Cpu,
  Package,
  RefreshCw,
  Sparkles,
} from 'lucide-react';
import { SectionCard } from '@/features/shared/components/layout/SectionCard';
import { SettingRow } from '@/features/shared/components/forms/SettingRow';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';
import { silentCatch } from '@/lib/silentCatch';
import {
  KOKORO_INSTALL_EVENT,
  companionTtsKokoroDownload,
  companionTtsKokoroStatus,
  companionTtsListKokoroVoices,
  type KokoroStatus,
  type KokoroVoiceEntry,
} from '@/api/companion';
import { SetupRow, VoiceEngineInstallBlock, PreviewButton, useVoicePreview } from './voiceEngineShared';

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
  const fullyInstalled = !!status?.engineInstalled && !!status?.modelInstalled;
  const showAutoInstall = !!status?.canAutoInstall && !fullyInstalled;

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
            {showAutoInstall && (
              <VoiceEngineInstallBlock
                progressEvent={KOKORO_INSTALL_EVENT}
                onDownload={companionTtsKokoroDownload}
                onDone={onRecheck}
                icon={<Sparkles className="w-4 h-4 text-primary" />}
                title={t.plugins.companion.voice_kokoro_install_title}
                desc={t.plugins.companion.voice_kokoro_install_desc}
                installButtonLabel={t.plugins.companion.voice_kokoro_install_button}
                logPrefix="kokoro.install"
              />
            )}
            {showAutoInstall && (
              <p className="typo-caption pt-0.5">{t.plugins.companion.voice_kokoro_install_manual}</p>
            )}
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

interface KokoroVoiceRowProps {
  voice: KokoroVoiceEntry;
  selected: boolean;
  previewable: boolean;
  onSelect: () => void;
}

function KokoroVoiceRow({ voice, selected, previewable, onSelect }: KokoroVoiceRowProps) {
  const { t } = useTranslation();
  const { previewState, onPreview } = useVoicePreview(voice.voiceId, 'kokoro', 'kokoro');

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
          <PreviewButton
            previewState={previewState}
            onPreview={onPreview}
            disabled={!previewable}
            title={
              previewable
                ? t.plugins.companion.voice_kokoro_preview
                : t.plugins.companion.voice_kokoro_preview_blocked
            }
          />
        </div>
      </div>
    </div>
  );
}
