import { useCallback, useEffect, useRef, useState } from 'react';
import { Volume2, VolumeX, Volume1, Play, Loader2, Square } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { useSystemStore } from '@/stores/systemStore';
import { AccessibleToggle } from '@/features/shared/components/forms/AccessibleToggle';
import { silentCatch } from '@/lib/silentCatch';
import { synthesize, play } from './voicePlayback';
import { useTtsSettings } from './useTtsSettings';

/**
 * Voice control for the chat toolbar — replaces the plain enable/disable
 * button with a popover that bundles the three things a user actually wants
 * in one place:
 *   - enable / disable spoken replies,
 *   - a playback volume slider (writes `companionVoiceVolume`, applied in
 *     `voicePlayback.play()`),
 *   - a "Test voice" button that synthesizes + plays a sample sentence so
 *     the user can hear the current engine/voice/volume without waiting for
 *     a real reply.
 *
 * The trigger keeps the toolbar's 32px button footprint; the panel opens to
 * the left (the toolbar hugs the right edge of the chat).
 */
type TestState = 'idle' | 'synthesizing' | 'playing';

export function VoiceControlPopover() {
  const { t } = useTranslation();
  const c = t.plugins.companion;

  const voiceEnabled = useSystemStore((s) => s.companionVoiceEnabled);
  const setVoiceEnabled = useSystemStore((s) => s.setCompanionVoiceEnabled);
  const volume = useSystemStore((s) => s.companionVoiceVolume);
  const setVolume = useSystemStore((s) => s.setCompanionVoiceVolume);
  const engine = useSystemStore((s) => s.companionVoiceEngine);
  const voiceCredentialId = useSystemStore((s) => s.companionVoiceCredentialId);
  const voiceId = useSystemStore((s) => s.companionVoiceId);
  const piperVoiceId = useSystemStore((s) => s.companionPiperVoiceId);
  const voiceSettings = useTtsSettings();

  const [open, setOpen] = useState(false);
  const [testState, setTestState] = useState<TestState>('idle');
  const wrapRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', handler);
    return () => window.removeEventListener('mousedown', handler);
  }, [open]);

  // Stop any in-flight test playback on unmount.
  useEffect(() => {
    return () => {
      audioRef.current?.pause();
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    };
  }, []);

  const stopTest = useCallback(() => {
    audioRef.current?.pause();
    audioRef.current = null;
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
    setTestState('idle');
  }, []);

  const runTest = useCallback(async () => {
    if (testState === 'playing') {
      stopTest();
      return;
    }
    const targetVoiceId = engine === 'piper' ? piperVoiceId : voiceId;
    if (!targetVoiceId) return;
    setTestState('synthesizing');
    try {
      const url = await synthesize(
        c.voice_test_sentence,
        engine === 'piper' ? null : voiceCredentialId,
        targetVoiceId,
        voiceSettings,
        engine,
      );
      urlRef.current = url;
      const { audio, done } = play(url);
      audioRef.current = audio;
      setTestState('playing');
      await done.catch(silentCatch('companion_voice_test_play'));
      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current);
        urlRef.current = null;
      }
      audioRef.current = null;
      setTestState('idle');
    } catch (err) {
      silentCatch('companion_voice_test_synthesize')(err);
      setTestState('idle');
    }
  }, [testState, stopTest, engine, piperVoiceId, voiceId, voiceCredentialId, voiceSettings, c.voice_test_sentence]);

  const voiceConfigured =
    engine === 'piper' ? Boolean(piperVoiceId) : Boolean(voiceCredentialId && voiceId);

  const VolumeIcon = !voiceEnabled || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;

  return (
    <div ref={wrapRef} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        data-testid="companion-voice-control"
        className={`w-8 h-8 rounded-interactive inline-flex items-center justify-center transition-colors focus-ring ${
          voiceEnabled
            ? 'bg-primary/15 text-primary'
            : 'text-foreground hover:text-foreground hover:bg-foreground/5'
        }`}
        aria-label={c.voice_controls_label}
        title={c.voice_controls_label}
        aria-expanded={open}
      >
        <VolumeIcon className="w-4 h-4" />
      </button>

      {open && (
        <div
          className="animate-fade-slide-in absolute right-full mr-2 top-0 w-64 rounded-card border border-primary/15 bg-background shadow-elevation-3 p-3 z-50"
          aria-label={c.voice_controls_label}
        >
          <div className="flex items-center justify-between gap-2 mb-3">
            <span className="typo-body font-medium text-primary">{c.voice_controls_title}</span>
            <AccessibleToggle
              checked={voiceEnabled}
              onChange={() => setVoiceEnabled(!voiceEnabled)}
              label={voiceEnabled ? c.voice_disable : c.voice_enable}
            />
          </div>

          {/* Volume */}
          <div className="space-y-1.5 mb-3">
            <div className="flex items-center justify-between">
              <label className="typo-caption text-foreground font-medium">{c.voice_volume_label}</label>
              <span className="typo-code text-[11px] text-foreground">{Math.round(volume * 100)}%</span>
            </div>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={volume}
              onChange={(e) => setVolume(Number(e.target.value))}
              className="w-full accent-primary"
              aria-label={c.voice_volume_label}
            />
          </div>

          {/* Test */}
          <button
            onClick={() => void runTest()}
            disabled={!voiceConfigured || testState === 'synthesizing'}
            data-testid="companion-voice-test"
            className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-interactive typo-caption font-medium bg-primary/15 hover:bg-primary/25 text-primary transition-colors focus-ring disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {testState === 'synthesizing' ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                {c.voice_test_synthesizing}
              </>
            ) : testState === 'playing' ? (
              <>
                <Square className="w-3 h-3" fill="currentColor" />
                {c.voice_test_stop}
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5" />
                {c.voice_test}
              </>
            )}
          </button>
          {!voiceConfigured && (
            <p className="typo-caption text-foreground mt-1.5">{c.voice_test_unconfigured}</p>
          )}
        </div>
      )}
    </div>
  );
}
