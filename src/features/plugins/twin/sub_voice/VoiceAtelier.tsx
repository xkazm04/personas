import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Volume2, Save, Trash2, ExternalLink, Loader2, Play, Square, Radio,
  KeyRound, Sliders, Cpu, Sparkles, Mic,
} from 'lucide-react';
import { useSystemStore } from '@/stores/systemStore';
import { Button } from '@/features/shared/components/buttons';
import { ConfirmDialog } from '@/features/shared/components/feedback/ConfirmDialog';
import { INPUT_FIELD } from '@/lib/utils/designTokens';
import { TwinEmptyState } from '../TwinEmptyState';
import { TwinHeaderBand } from '../_shared/TwinHeaderBand';
import { WaveformDecoration } from '../_shared/decorations';
import { useTranslation } from '@/i18n/useTranslation';
import { toastCatch } from '@/lib/silentCatch';
import { companionTts } from '@/api/companion';
import { CoachMark } from '../CoachMark';
import type { LucideIcon } from 'lucide-react';

/* ------------------------------------------------------------------ *
 *  Atelier — "Voice Studio"
 *  Mirrors the Tone/Profiles Atelier pattern: violet hero band with the
 *  waveform motif + KPI rail, a stage card that reads "no voice yet"
 *  or "ready to synthesize", and three structured sections (identity,
 *  model, synthesis). The preview button doubles as the stage primary.
 * ------------------------------------------------------------------ */

const ELEVENLABS_MODELS = [
  { id: 'eleven_multilingual_v2', label: 'Multilingual v2' },
  { id: 'eleven_monolingual_v1', label: 'Monolingual v1' },
  { id: 'eleven_turbo_v2_5', label: 'Turbo v2.5' },
  { id: 'eleven_turbo_v2', label: 'Turbo v2' },
] as const;

export default function VoiceAtelier() {
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

  useEffect(() => {
    return () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
      if (audioRef.current) audioRef.current.pause();
    };
  }, []);

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

  const previewReady = voiceId.trim().length > 0 && credentialId.trim().length > 0;
  const configured = !!voiceProfile;
  const activeModelLabel = useMemo(
    () => ELEVENLABS_MODELS.find((m) => m.id === modelId)?.label ?? modelId,
    [modelId],
  );

  if (!activeTwinId) return <TwinEmptyState icon={Volume2} title={t.voice.title} />;

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
      <TwinHeaderBand
        accent="violet"
        icon={<Volume2 className="w-5 h-5 text-violet-300" />}
        eyebrow={t.voice.eyebrowAtelier}
        title={t.voice.title}
        subtitle={t.voice.subtitle}
        decoration={<div className="text-violet-300"><WaveformDecoration /></div>}
        kpis={
          <>
            <KpiCell
              label={t.voice.kpiVoiceSet}
              value={voiceId.trim() ? t.voice.kpiReady : t.voice.kpiMissing}
              accent={voiceId.trim() ? 'emerald' : 'amber'}
            />
            <span className="w-px h-6 bg-primary/15" />
            <KpiCell
              label={t.voice.kpiCredential}
              value={credentialId.trim() ? t.voice.kpiReady : t.voice.kpiMissing}
              accent={credentialId.trim() ? 'emerald' : 'amber'}
            />
            <span className="w-px h-6 bg-primary/15" />
            <KpiCell label={t.voice.kpiModel} value={activeModelLabel} accent="violet" />
            <span className="w-px h-6 bg-primary/15" />
            <KpiCell
              label={t.voice.kpiPreview}
              value={previewReady ? t.voice.kpiReady : t.voice.kpiMissing}
              accent={previewReady ? 'emerald' : 'amber'}
            />
          </>
        }
        actions={
          configured ? (
            <Button onClick={() => setConfirmingRemove(true)} size="sm" variant="ghost">
              <Trash2 className="w-4 h-4 mr-1.5" />
              {t.voice.removeVoice}
            </Button>
          ) : null
        }
      />

      <div className="flex-1 min-h-0 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <p className="typo-body text-foreground">{t.voice.loading}</p>
          </div>
        ) : (
          <div className="max-w-[1100px] mx-auto px-4 md:px-6 xl:px-8 py-6 space-y-5">
            <CoachMark id="voice" title={t.coach.voiceTitle} body={t.coach.voiceBody} />

            {configured && !hasVoiceChannel && (
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

            {/* Stage card — primary hero */}
            <StageCard
              previewReady={previewReady}
              configured={configured}
              previewState={previewState}
              voiceId={voiceId.trim()}
              modelLabel={activeModelLabel}
              onPreview={handlePreview}
              onStopPreview={handleStopPreview}
              previewLabel={t.voice.previewCta}
              previewLoadingLabel={t.voice.previewLoading}
              previewStopLabel={t.voice.previewStop}
              previewNeedsConfigTooltip={t.voice.previewNeedsConfig}
              previewTooltip={t.voice.previewTooltip}
              emptyHeadline={t.voice.stageEmptyHeadline}
              emptyBody={t.voice.stageEmptyBody}
              readyHeadline={t.voice.stageReadyHeadline}
              readyBody={t.voice.stageReadyBody}
            />

            {/* Identity section — voice id + credential */}
            <Section icon={KeyRound} label={t.voice.sectionIdentity}>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <label className="space-y-1.5 block">
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
                <label className="space-y-1.5 block">
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
            </Section>

            {/* Model section */}
            <Section icon={Cpu} label={t.voice.sectionModel}>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {ELEVENLABS_MODELS.map((m) => {
                  const isActive = m.id === modelId;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => { setModelId(m.id); markDirty(); }}
                      className={[
                        'px-3 py-2 rounded-interactive border text-left transition-colors',
                        isActive
                          ? 'border-violet-500/40 bg-violet-500/10 text-violet-200'
                          : 'border-primary/10 bg-secondary/30 text-foreground hover:border-primary/20 hover:bg-secondary/50',
                      ].join(' ')}
                    >
                      <span className="typo-caption font-medium block truncate">{m.label}</span>
                      <span className="text-[10px] font-mono text-foreground truncate block">{m.id}</span>
                    </button>
                  );
                })}
              </div>
            </Section>

            {/* Synthesis sliders */}
            <Section icon={Sliders} label={t.voice.sectionSynthesis}>
              <div className="space-y-5">
                <SliderRow
                  label={t.voice.stability}
                  value={stability}
                  onChange={(v) => { setStability(v); markDirty(); }}
                  leftLabel={t.voice.moreExpressive}
                  rightLabel={t.voice.moreConsistent}
                />
                <SliderRow
                  label={t.voice.similarityBoost}
                  value={similarityBoost}
                  onChange={(v) => { setSimilarityBoost(v); markDirty(); }}
                  leftLabel={t.voice.moreNatural}
                  rightLabel={t.voice.closerToOriginal}
                />
                <SliderRow
                  label={t.voice.style}
                  value={style}
                  onChange={(v) => { setStyle(v); markDirty(); }}
                  leftLabel={t.voice.neutral}
                  rightLabel={t.voice.exaggerated}
                />
              </div>
            </Section>

            {/* Save footer */}
            <div className="sticky bottom-0 -mx-4 md:-mx-6 xl:-mx-8 px-4 md:px-6 xl:px-8 py-3 border-t border-primary/10 bg-background/85 backdrop-blur flex items-center justify-end gap-2">
              <Button
                onClick={previewState === 'playing' ? handleStopPreview : handlePreview}
                disabled={!previewReady || previewState === 'loading'}
                size="sm"
                variant="ghost"
                title={!previewReady ? t.voice.previewNeedsConfig : t.voice.previewTooltip}
              >
                {previewState === 'loading' && (<><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />{t.voice.previewLoading}</>)}
                {previewState === 'playing' && (<><Square className="w-3.5 h-3.5 mr-1.5" />{t.voice.previewStop}</>)}
                {previewState === 'idle' && (<><Play className="w-3.5 h-3.5 mr-1.5" />{t.voice.previewCta}</>)}
              </Button>
              {(dirty || !voiceProfile) && (
                <Button onClick={handleSave} disabled={saving || !voiceId.trim()} size="sm" variant="accent" accentColor="violet">
                  <Save className="w-4 h-4 mr-1.5" />
                  {saving ? t.voice.saving : voiceProfile ? t.voice.save : t.voice.configureVoice}
                </Button>
              )}
            </div>
          </div>
        )}
      </div>

      {confirmingRemove && (
        <ConfirmDialog
          danger
          title={t.voice.removeVoiceConfirm}
          onConfirm={performDelete}
          onCancel={() => setConfirmingRemove(false)}
        />
      )}
    </div>
  );
}

/* ── Stage card ─────────────────────────────────────────────────────── */

interface StageCardProps {
  previewReady: boolean;
  configured: boolean;
  previewState: 'idle' | 'loading' | 'playing';
  voiceId: string;
  modelLabel: string;
  onPreview: () => void;
  onStopPreview: () => void;
  previewLabel: string;
  previewLoadingLabel: string;
  previewStopLabel: string;
  previewNeedsConfigTooltip: string;
  previewTooltip: string;
  emptyHeadline: string;
  emptyBody: string;
  readyHeadline: string;
  readyBody: string;
}

function StageCard(p: StageCardProps) {
  const ready = p.previewReady;
  const accent = ready ? 'border-violet-500/30 bg-gradient-to-br from-violet-500/12 via-card/40 to-fuchsia-500/8 shadow-[0_0_24px_rgba(167,139,250,0.18)]'
                       : 'border-primary/10 bg-card/40';
  const Icon: LucideIcon = ready ? Sparkles : Mic;
  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={ready ? 'ready' : 'empty'}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -4 }}
        transition={{ duration: 0.25 }}
        className={`relative rounded-card border p-5 md:p-6 ${accent}`}
      >
        <div className="flex flex-col md:flex-row items-start md:items-center gap-4">
          <div className="w-12 h-12 rounded-full bg-card/60 border border-violet-500/30 flex items-center justify-center flex-shrink-0">
            <Icon className="w-5 h-5 text-violet-300" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="typo-section-title text-foreground/95">{ready ? p.readyHeadline : p.emptyHeadline}</h2>
            <p className="typo-caption text-foreground mt-1 max-w-prose">{ready ? p.readyBody : p.emptyBody}</p>
            {ready && p.configured && (
              <div className="flex flex-wrap items-center gap-2 mt-2">
                <span className="px-2 py-0.5 text-[10px] uppercase tracking-wider rounded-full bg-violet-500/15 text-violet-300 border border-violet-500/25 font-mono">
                  {p.voiceId.slice(0, 12)}{p.voiceId.length > 12 ? '…' : ''}
                </span>
                <span className="px-2 py-0.5 text-[10px] rounded-full bg-secondary/50 text-foreground border border-primary/10">{p.modelLabel}</span>
              </div>
            )}
          </div>
          <Button
            onClick={p.previewState === 'playing' ? p.onStopPreview : p.onPreview}
            disabled={!ready || p.previewState === 'loading'}
            size="sm"
            variant={ready ? 'accent' : 'ghost'}
            accentColor="violet"
            title={!ready ? p.previewNeedsConfigTooltip : p.previewTooltip}
          >
            {p.previewState === 'loading' && (<><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />{p.previewLoadingLabel}</>)}
            {p.previewState === 'playing' && (<><Square className="w-3.5 h-3.5 mr-1.5" />{p.previewStopLabel}</>)}
            {p.previewState === 'idle' && (<><Play className="w-3.5 h-3.5 mr-1.5" />{p.previewLabel}</>)}
          </Button>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

/* ── Reusable section + slider primitives ──────────────────────────── */

function Section({ icon: Icon, label, children }: { icon: LucideIcon; label: string; children: React.ReactNode }) {
  return (
    <section className="rounded-card border border-primary/10 bg-card/40 p-4 md:p-5">
      <div className="flex items-center gap-2 mb-3">
        <Icon className="w-3.5 h-3.5 text-violet-300" />
        <span className="typo-caption font-medium text-foreground">{label}</span>
      </div>
      {children}
    </section>
  );
}

interface SliderRowProps {
  label: string;
  value: number;
  onChange: (v: number) => void;
  leftLabel: string;
  rightLabel: string;
}
function SliderRow({ label, value, onChange, leftLabel, rightLabel }: SliderRowProps) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="typo-caption text-foreground font-medium">{label}</span>
        <span className="typo-data-md tabular-nums text-violet-300">{value.toFixed(2)}</span>
      </div>
      <input
        type="range"
        min={0} max={1} step={0.05}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full"
        style={{ ['--slider-progress' as string]: value }}
      />
      <div className="flex justify-between typo-caption text-foreground mt-0.5">
        <span>{leftLabel}</span>
        <span>{rightLabel}</span>
      </div>
    </div>
  );
}

/* ── KPI cell (mirrors ToneAtelier) ────────────────────────────────── */

const ACCENT_TEXT: Record<string, string> = {
  violet: 'text-violet-300',
  emerald: 'text-emerald-300',
  amber: 'text-amber-300',
};

function KpiCell({ label, value, accent = 'violet' }: { label: string; value: number | string; accent?: keyof typeof ACCENT_TEXT }) {
  return (
    <div className="flex flex-col items-start leading-tight">
      <span className={`typo-data-md tabular-nums ${ACCENT_TEXT[accent] ?? ACCENT_TEXT.violet} truncate max-w-[120px]`}>{value}</span>
      <span className="text-[9px] uppercase tracking-[0.18em] text-foreground">{label}</span>
    </div>
  );
}
