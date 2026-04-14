import { useEffect, useState } from 'react';
import { Volume2, Save, Trash2, ExternalLink } from 'lucide-react';
import { useSystemStore } from '@/stores/systemStore';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { Button } from '@/features/shared/components/buttons';
import { INPUT_FIELD } from '@/lib/utils/designTokens';
import { TwinEmptyState } from '../TwinEmptyState';

/**
 * Voice tab — ElevenLabs voice configuration (picker mode).
 *
 * The user pastes their voice_id from the ElevenLabs dashboard and adjusts
 * synthesis sliders (stability, similarity, style). The credential_id
 * points to their ElevenLabs API key in the credential vault.
 *
 * P3 is picker-only: no live API calls to ElevenLabs, no voice cloning.
 * The config is stored so the connector tool `synthesize_speech` has
 * everything it needs when the runtime implements the actual HTTP call.
 */

const ELEVENLABS_MODELS = [
  { id: 'eleven_multilingual_v2', label: 'Multilingual v2' },
  { id: 'eleven_monolingual_v1', label: 'Monolingual v1' },
  { id: 'eleven_turbo_v2_5', label: 'Turbo v2.5' },
  { id: 'eleven_turbo_v2', label: 'Turbo v2' },
] as const;

export default function VoicePage() {
  const activeTwinId = useSystemStore((s) => s.activeTwinId);
  const voiceProfile = useSystemStore((s) => s.twinVoiceProfile);
  const isLoading = useSystemStore((s) => s.twinVoiceLoading);
  const fetchVoiceProfile = useSystemStore((s) => s.fetchTwinVoiceProfile);
  const upsertVoiceProfile = useSystemStore((s) => s.upsertTwinVoiceProfile);
  const deleteVoiceProfile = useSystemStore((s) => s.deleteTwinVoiceProfile);

  const [voiceId, setVoiceId] = useState('');
  const [modelId, setModelId] = useState('eleven_multilingual_v2');
  const [credentialId, setCredentialId] = useState('');
  const [stability, setStability] = useState(0.5);
  const [similarityBoost, setSimilarityBoost] = useState(0.75);
  const [style, setStyle] = useState(0.0);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (activeTwinId) fetchVoiceProfile(activeTwinId);
  }, [activeTwinId, fetchVoiceProfile]);

  // Sync form when profile loads
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

  const handleDelete = async () => {
    if (!activeTwinId) return;
    if (!confirm('Remove voice configuration? The twin will have no voice until reconfigured.')) return;
    await deleteVoiceProfile(activeTwinId);
  };

  if (!activeTwinId) {
    return <TwinEmptyState icon={Volume2} title="Voice" />;
  }

  return (
    <ContentBox>
      <ContentHeader
        icon={<Volume2 className="w-5 h-5 text-violet-400" />}
        iconColor="violet"
        title="Voice"
        subtitle="Configure the twin's voice for speech synthesis via ElevenLabs."
      />

      <ContentBody centered>
        {isLoading ? (
          <p className="typo-body text-foreground text-center py-12">Loading...</p>
        ) : (
          <div className="max-w-2xl mx-auto space-y-6 pb-8">
            {/* Voice ID + Credential */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <label className="space-y-1.5">
                <span className="typo-caption text-foreground font-medium">Voice ID</span>
                <input
                  type="text"
                  placeholder="Paste from ElevenLabs dashboard"
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
                  Find voices on ElevenLabs
                </a>
              </label>
              <label className="space-y-1.5">
                <span className="typo-caption text-foreground font-medium">Credential ID</span>
                <input
                  type="text"
                  placeholder="ElevenLabs API key credential (optional)"
                  value={credentialId}
                  onChange={(e) => { setCredentialId(e.target.value); markDirty(); }}
                  className={`${INPUT_FIELD} font-mono`}
                />
                <p className="typo-caption text-muted-foreground">
                  From the credential vault. Required for speech synthesis.
                </p>
              </label>
            </div>

            {/* Model selector */}
            <label className="space-y-1.5 block">
              <span className="typo-caption text-foreground font-medium">Model</span>
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

            {/* Sliders */}
            <div className="space-y-4">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="typo-caption text-foreground font-medium">Stability</span>
                  <span className="typo-caption text-muted-foreground">{stability.toFixed(2)}</span>
                </div>
                <input
                  type="range"
                  min={0} max={1} step={0.05}
                  value={stability}
                  onChange={(e) => { setStability(parseFloat(e.target.value)); markDirty(); }}
                  className="w-full accent-violet-400"
                />
                <div className="flex justify-between typo-caption text-muted-foreground mt-0.5">
                  <span>More expressive</span>
                  <span>More consistent</span>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="typo-caption text-foreground font-medium">Similarity Boost</span>
                  <span className="typo-caption text-muted-foreground">{similarityBoost.toFixed(2)}</span>
                </div>
                <input
                  type="range"
                  min={0} max={1} step={0.05}
                  value={similarityBoost}
                  onChange={(e) => { setSimilarityBoost(parseFloat(e.target.value)); markDirty(); }}
                  className="w-full accent-violet-400"
                />
                <div className="flex justify-between typo-caption text-muted-foreground mt-0.5">
                  <span>More natural</span>
                  <span>Closer to original</span>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="typo-caption text-foreground font-medium">Style</span>
                  <span className="typo-caption text-muted-foreground">{style.toFixed(2)}</span>
                </div>
                <input
                  type="range"
                  min={0} max={1} step={0.05}
                  value={style}
                  onChange={(e) => { setStyle(parseFloat(e.target.value)); markDirty(); }}
                  className="w-full accent-violet-400"
                />
                <div className="flex justify-between typo-caption text-muted-foreground mt-0.5">
                  <span>Neutral</span>
                  <span>Exaggerated</span>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center justify-between pt-2">
              {voiceProfile ? (
                <button
                  onClick={handleDelete}
                  className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-red-400 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Remove voice
                </button>
              ) : (
                <span />
              )}
              {(dirty || !voiceProfile) && (
                <Button onClick={handleSave} disabled={saving || !voiceId.trim()} size="sm">
                  <Save className="w-4 h-4 mr-1.5" />
                  {saving ? 'Saving...' : voiceProfile ? 'Save' : 'Configure Voice'}
                </Button>
              )}
            </div>
          </div>
        )}
      </ContentBody>
    </ContentBox>
  );
}
