import { useEffect, useRef, useState } from 'react';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { Volume2, Save, Trash2, ExternalLink, Loader2, Play, Square, Radio } from 'lucide-react';
import { useSystemStore } from '@/stores/systemStore';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { Button } from '@/features/shared/components/buttons';
import { ConfirmDialog } from '@/features/shared/components/feedback/ConfirmDialog';
import { Slider } from '@/features/shared/components/forms/Slider';
import { INPUT_FIELD } from '@/lib/utils/designTokens';
import { TwinEmptyState } from '../TwinEmptyState';
import { useTranslation } from '@/i18n/useTranslation';
import { toastCatch } from '@/lib/silentCatch';
import { companionTts } from '@/api/companion';
import { CoachMark } from '../CoachMark';

/**
 * Current (baseline) Voice tab — ElevenLabs voice configuration (picker mode).
 *
 * The user pastes their voice_id from the ElevenLabs dashboard and adjusts
 * synthesis sliders (stability, similarity, style). The credential_id
 * points to their ElevenLabs API key in the credential vault.
 *
 * Kept available behind the Voice variant switcher while the Atelier
 * prototype is being evaluated.
 */

const ELEVENLABS_MODELS = [
  { id: 'eleven_multilingual_v2', label: 'Multilingual v2' },
  { id: 'eleven_monolingual_v1', label: 'Monolingual v1' },
  { id: 'eleven_turbo_v2_5', label: 'Turbo v2.5' },
  { id: 'eleven_turbo_v2', label: 'Turbo v2' },
] as const;

export default function VoiceBaseline() {
  const t = useTranslation().t.twin;
  const activeTwinId = useSystemStore((s) => s.activeTwinId);
  const voiceProfile = useSystemStore((s) => s.twinVoiceProfile);
  const isLoading = useSystemStore((s) => s.twinVoiceLoading);
  const fetchVoiceProfile = useSystemStore((s) => s.fetchTwinVoiceProfile);
  const upsertVoiceProfile = useSystemStore((s) => s.upsertTwinVoiceProfile);
  const deleteVoiceProfile = useSystemStore((s) => s.deleteTwinVoiceProfile);
  const twinChannels = useSystemStore((s) => s.twinChannels);
  const setTwinTab = useSystemStore((s) => s.setTwinTab);
  const hasVoiceChannel = twinChannels.some(
    (c) => c.twin_id === activeTwinId && c.channel_type === 'voice' && c.is_active,
  );

  const [voiceId, setVoiceId] = useState('');
  const [modelId, setModelId] = useState('eleven_multilingual_v2');
  const [credentialId, setCredentialId] = useState('');
  const [stability, setStability] = useState(0.5);
  const [similarityBoost, setSimilarityBoost] = useState(0.75);
  const [style, setStyle] = useState(0.0);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [previewState, setPreviewState] = useState<'idle' | 'loading' | 'playing'>('idle');
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const previewUrlRef = useRef<string | null>(null);

  useEffect(() => {
    if (activeTwinId) fetchVoiceProfile(activeTwinId);
  }, [activeTwinId, fetchVoiceProfile]);

  useEffect(() => {
    if (voiceProfile) {
      setVoiceId(voiceProfile.voice_id);
      setModelId(voiceProfile.model_id ?? 'eleven_multilingual_v2');
      setCredentialId(voiceProfile.credential_id ?? '');
      setStability(voiceProfile.stability);
      setSimilarityBoost(voiceProfile.similarity_boost);
      setStyle(voiceProfile.style);
      setDirty(false);
    } else {
      setVoiceId('');
      setModelId('eleven_multilingual_v2');
      setCredentialId('');
      setStability(0.5);
      setSimilarityBoost(0.75);
      setStyle(0.0);
      setDirty(false);
    }
  }, [voiceProfile]);

  const markDirty = () => setDirty(true);

  const handleSave = async () => {
    if (!activeTwinId || !voiceId.trim()) return;
    setSaving(true);
    try {
      await upsertVoiceProfile(
        activeTwinId,
        voiceId.trim(),
        credentialId.trim() || null,
        modelId,
        stability,
        similarityBoost,
        style,
      );
      setDirty(false);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = () => {
    if (!activeTwinId) return;
    setConfirmingRemove(true);
  };

  useEffect(() => {
    return () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
      if (audioRef.current) audioRef.current.pause();
    };
  }, []);

  const handleStopPreview = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    setPreviewState('idle');
  };

  const handlePreview = async () => {
    if (!voiceId.trim() || !credentialId.trim()) return;
    handleStopPreview();
    setPreviewState('loading');
    try {
      const audio = await companionTts(
        t.voice.previewSample,
        credentialId.trim(),
        voiceId.trim(),
        { modelId, stability, similarityBoost, style },
        'elevenlabs',
      );
      const bin = atob(audio.audioBase64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const blob = new Blob([bytes], { type: audio.mimeType });
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
      const url = URL.createObjectURL(blob);
      previewUrlRef.current = url;
      const el = new Audio(url);
      audioRef.current = el;
      el.onended = () => setPreviewState('idle');
      el.onerror = () => setPreviewState('idle');
      await el.play();
      setPreviewState('playing');
    } catch (err) {
      toastCatch('twin:preview-voice')(err);
      setPreviewState('idle');
    }
  };
  const performDelete = async () => {
    if (!activeTwinId) {
      setConfirmingRemove(false);
      return;
    }
    await deleteVoiceProfile(activeTwinId);
    setConfirmingRemove(false);
  };

  if (!activeTwinId) {
    return <TwinEmptyState icon={Volume2} title={t.voice.title} />;
  }

  return (
    <ContentBox>
      <ContentHeader
        icon={<Volume2 className="w-5 h-5 text-violet-400" />}
        iconColor="violet"
        title={t.voice.title}
        subtitle={t.voice.subtitle}
      />

      <ContentBody centered>
        {isLoading ? (
          <p className="typo-body text-foreground text-center py-12">{t.voice.loading}</p>
        ) : (
          <div className="max-w-2xl mx-auto space-y-6 pb-8">
            <CoachMark id="voice" title={t.coach.voiceTitle} body={t.coach.voiceBody} />

            {voiceProfile && !hasVoiceChannel && (
              <div className="p-3 rounded-card border border-amber-500/25 bg-amber-500/5 flex items-center gap-3">
                <Radio className="w-4 h-4 text-amber-400 flex-shrink-0" />
                <p className="typo-caption text-foreground flex-1">{t.nudges.voiceUndeployed}</p>
                <button
                  onClick={() => setTwinTab('channels')}
                  className="px-2.5 py-1 text-[11px] font-medium text-amber-400 bg-amber-500/10 border border-amber-500/25 rounded-interactive hover:bg-amber-500/20 transition-colors flex-shrink-0"
                >
                  {t.nudges.voiceUndeployedCta}
                </button>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <label className="space-y-1.5">
                <span className="typo-caption text-foreground font-medium">{t.voice.voiceId}</span>
                <input
                  type="text"
                  placeholder={t.voice.voiceIdPlaceholder}
                  value={voiceId}
                  onChange={(e) => { setVoiceId(e.target.value); markDirty(); }}
                  className={`${INPUT_FIELD} font-mono`}
                />
                <a
                  href="https://elevenlabs.io/app/voice-library"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 typo-caption text-violet-400 hover:text-violet-300 mt-0.5"
                >
                  <ExternalLink className="w-3 h-3" />
                  {t.voice.findVoices}
                </a>
              </label>
              <label className="space-y-1.5">
                <span className="typo-caption text-foreground font-medium">{t.voice.credentialId}</span>
                <input
                  type="text"
                  placeholder={t.voice.credentialIdPlaceholder}
                  value={credentialId}
                  onChange={(e) => { setCredentialId(e.target.value); markDirty(); }}
                  className={`${INPUT_FIELD} font-mono`}
                />
                <p className="typo-caption text-foreground">{t.voice.credentialIdHint}</p>
              </label>
            </div>

            <label className="space-y-1.5 block">
              <span className="typo-caption text-foreground font-medium">{t.voice.model}</span>
              <select
                value={modelId}
                onChange={(e) => { setModelId(e.target.value); markDirty(); }}
                className={INPUT_FIELD}
              >
                {ELEVENLABS_MODELS.map((m) => (
                  <option key={m.id} value={m.id}>{m.label}</option>
                ))}
              </select>
            </label>

            <div className="space-y-4">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="typo-caption text-foreground font-medium">{t.voice.stability}</span>
                  <span className="typo-caption text-foreground"><Numeric value={stability} precision={2} /></span>
                </div>
                <Slider
                  min={0} max={1} step={0.05}
                  value={stability}
                  onChange={(v) => { setStability(v); markDirty(); }}
                  ariaLabel={t.voice.stability}
                  showBubble={false}
                />
                <div className="flex justify-between typo-caption text-foreground mt-0.5">
                  <span>{t.voice.moreExpressive}</span>
                  <span>{t.voice.moreConsistent}</span>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="typo-caption text-foreground font-medium">{t.voice.similarityBoost}</span>
                  <span className="typo-caption text-foreground"><Numeric value={similarityBoost} precision={2} /></span>
                </div>
                <Slider
                  min={0} max={1} step={0.05}
                  value={similarityBoost}
                  onChange={(v) => { setSimilarityBoost(v); markDirty(); }}
                  ariaLabel={t.voice.similarityBoost}
                  showBubble={false}
                />
                <div className="flex justify-between typo-caption text-foreground mt-0.5">
                  <span>{t.voice.moreNatural}</span>
                  <span>{t.voice.closerToOriginal}</span>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="typo-caption text-foreground font-medium">{t.voice.style}</span>
                  <span className="typo-caption text-foreground"><Numeric value={style} precision={2} /></span>
                </div>
                <Slider
                  min={0} max={1} step={0.05}
                  value={style}
                  onChange={(v) => { setStyle(v); markDirty(); }}
                  ariaLabel={t.voice.style}
                  showBubble={false}
                />
                <div className="flex justify-between typo-caption text-foreground mt-0.5">
                  <span>{t.voice.neutral}</span>
                  <span>{t.voice.exaggerated}</span>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between pt-2">
              {voiceProfile ? (
                <button
                  onClick={handleDelete}
                  aria-label={t.voice.removeVoice}
                  className="flex items-center gap-1.5 text-md text-foreground hover:text-red-400 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  {t.voice.removeVoice}
                </button>
              ) : (
                <span />
              )}
              <div className="flex items-center gap-2">
                <Button
                  onClick={previewState === 'playing' ? handleStopPreview : handlePreview}
                  disabled={!voiceId.trim() || !credentialId.trim() || previewState === 'loading'}
                  size="sm"
                  variant="ghost"
                  title={!voiceId.trim() || !credentialId.trim() ? t.voice.previewNeedsConfig : t.voice.previewTooltip}
                >
                  {previewState === 'loading' && (<><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />{t.voice.previewLoading}</>)}
                  {previewState === 'playing' && (<><Square className="w-3.5 h-3.5 mr-1.5" />{t.voice.previewStop}</>)}
                  {previewState === 'idle' && (<><Play className="w-3.5 h-3.5 mr-1.5" />{t.voice.previewCta}</>)}
                </Button>
                {(dirty || !voiceProfile) && (
                  <Button onClick={handleSave} disabled={saving || !voiceId.trim()} size="sm">
                    <Save className="w-4 h-4 mr-1.5" />
                    {saving ? t.voice.saving : voiceProfile ? t.voice.save : t.voice.configureVoice}
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}
      </ContentBody>
      {confirmingRemove && (
        <ConfirmDialog
          danger
          title={t.voice.removeVoiceConfirm}
          onConfirm={performDelete}
          onCancel={() => setConfirmingRemove(false)}
        />
      )}
    </ContentBox>
  );
}
