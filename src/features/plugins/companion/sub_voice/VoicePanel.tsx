import { AudioWaveform, Sparkles } from 'lucide-react';
import { SectionCard } from '@/features/shared/components/layout/SectionCard';
import { Slider } from '@/features/shared/components/forms/Slider';
import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';
import {
  normalizeCompanionTtsEngine,
  type CompanionTtsEngine,
} from '@/stores/slices/system/companionPluginSlice';
import KokoroVoicePanel from './KokoroVoicePanel';
import PocketVoicePanel from './PocketVoicePanel';
import SttPanel from './SttPanel';

/**
 * Voice tab entry point. Owns the engine selector at the top and dispatches
 * to the per-engine panel: Kokoro (primary — curated local voices) or
 * Pocket TTS (experimental — zero-shot voice cloning). Splitting by engine
 * keeps each panel's state contract narrow. The ElevenLabs (cloud) and
 * Piper (per-voice download) engines were descoped 2026-07-10; persisted
 * selections from before then normalize onto Kokoro.
 */
export default function VoicePanel() {
  const engine = normalizeCompanionTtsEngine(
    useSystemStore((s) => s.companionVoiceEngine),
  );
  return (
    <div className="space-y-4 max-w-2xl">
      <EngineSelectorCard />
      {engine === 'pocket_tts' ? <PocketVoicePanel /> : <KokoroVoicePanel />}
      <SttPanel />
    </div>
  );
}

function EngineSelectorCard() {
  const { t } = useTranslation();
  const engine = normalizeCompanionTtsEngine(
    useSystemStore((s) => s.companionVoiceEngine),
  );
  const setEngine = useSystemStore((s) => s.setCompanionVoiceEngine);
  const voiceEnabled = useSystemStore((s) => s.companionVoiceEnabled);
  const setVoiceEnabled = useSystemStore((s) => s.setCompanionVoiceEnabled);
  const volume = useSystemStore((s) => s.companionVoiceVolume);
  const setVolume = useSystemStore((s) => s.setCompanionVoiceVolume);

  // Switching engines invalidates the playback gate — disable until the
  // new engine reports it's configured. Avoids a state where the toggle
  // says "on" but the synthesis path silently falls back / errors.
  const onSwitch = (next: CompanionTtsEngine) => {
    if (next === engine) return;
    setEngine(next);
    if (voiceEnabled) setVoiceEnabled(false);
  };

  return (
    <SectionCard
      title={t.plugins.companion.voice_engine_title}
      subtitle={t.plugins.companion.voice_engine_desc}
      titleClassName="text-primary"
    >
      <div className="grid grid-cols-2 gap-2 px-1 py-2">
        <EngineButton
          active={engine === 'kokoro'}
          onClick={() => onSwitch('kokoro')}
          icon={<Sparkles className="w-4 h-4" />}
          label={t.plugins.companion.voice_engine_kokoro}
          caption={t.plugins.companion.voice_engine_kokoro_caption}
        />
        <EngineButton
          active={engine === 'pocket_tts'}
          onClick={() => onSwitch('pocket_tts')}
          icon={<AudioWaveform className="w-4 h-4" />}
          label={t.plugins.companion.voice_engine_pocket}
          caption={t.plugins.companion.voice_engine_pocket_caption}
        />
      </div>

      {/* Playback volume — engine-agnostic; mirrors the chat toolbar's
          voice popover (both bind `companionVoiceVolume`). */}
      <div className="px-1 pt-1 pb-2 space-y-1.5">
        <div className="flex items-center justify-between">
          <label className="typo-title">
            {t.plugins.companion.voice_volume_label}
          </label>
          <span className="typo-code text-[11px] text-foreground">{Math.round(volume * 100)}%</span>
        </div>
        <Slider
          min={0}
          max={1}
          step={0.05}
          value={volume}
          onChange={(v) => setVolume(v)}
          ariaLabel={t.plugins.companion.voice_volume_label}
          showBubble={false}
        />
      </div>
    </SectionCard>
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
        <span
          className={`typo-body font-medium ${active ? 'text-cyan-200' : 'text-foreground'}`}
        >
          {label}
        </span>
      </div>
      <p className="typo-caption mt-1">{caption}</p>
    </button>
  );
}
