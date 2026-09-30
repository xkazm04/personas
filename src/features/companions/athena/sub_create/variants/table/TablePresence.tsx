import { useEffect, useRef } from 'react';
import { AthenaAvatar } from '@/features/companions/athena/AthenaAvatar';
import { subscribeAudioLevel } from '@/features/companions/athena/audioLevel';
import { useTranslation } from '@/i18n/useTranslation';
import type { CreateAthenaEngine } from '../../engine/createAthenaTypes';

/**
 * The presence header: her orb, her name, what she is doing. The ring round
 * the orb is real install progress while her voice downloads and closes when
 * it is on disk; the glow breathes with the real playback level (written to
 * a CSS variable on the analyser's own frame, no React state at 60 fps).
 */
function ringProgress(engine: CreateAthenaEngine): number {
  const { card, stepIndex, steps } = engine;
  if (card.kind === 'install') {
    const s = card.state;
    if (s.phase === 'completed' || s.phase === 'not_needed') return 1;
    return s.bytesTotal ? Math.min(1, s.bytesDownloaded / s.bytesTotal) : 0;
  }
  const installAt = steps.findIndex((s) => s.id === 'voice_install');
  return stepIndex > installAt ? 1 : 0;
}

function useStatus(engine: CreateAthenaEngine, typing: boolean): string {
  const { t } = useTranslation();
  const c = t.athena;
  const { card } = engine;
  if (engine.speaking) return c.table_status_speaking;
  if (card.kind === 'stt' && card.recording) return c.table_status_listening;
  if (card.kind === 'install' && ['downloading_engine', 'downloading_model', 'extracting'].includes(card.state.phase)) {
    return c.table_status_installing;
  }
  return typing ? c.table_status_typing : c.table_status_here;
}

export function TablePresence({ engine, typing }: { engine: CreateAthenaEngine; typing: boolean }) {
  const { t } = useTranslation();
  const orbRef = useRef<HTMLDivElement | null>(null);
  const status = useStatus(engine, typing);

  useEffect(() => {
    const el = orbRef.current;
    if (!el) return;
    const off = subscribeAudioLevel((lvl) => el.style.setProperty('--lvl', lvl.toFixed(3)));
    return () => {
      off();
      el.style.setProperty('--lvl', '0');
    };
  }, []);

  return (
    <header className="tb-presence" data-testid="create-athena-table-presence">
      <div
        ref={orbRef}
        className="tb-orb"
        style={{ ['--progress' as string]: ringProgress(engine) }}
        data-speaking={engine.speaking ? 'true' : 'false'}
        aria-hidden="true"
      >
        <span className="tb-orb-ring" />
        <span className="tb-orb-glow" />
        <span className="tb-orb-face">
          <AthenaAvatar fill state={engine.speaking ? 'speaking' : typing ? 'composing' : 'idle'} />
        </span>
      </div>
      <div className="tb-who">
        <h1 className="typo-section-title text-foreground">{t.athena.name}</h1>
        <div className="tb-status typo-body" aria-live="polite" data-testid="create-athena-table-status">
          {status}
        </div>
      </div>
      <div className="tb-presence-end typo-body">
        <kbd>?</kbd> {t.athena.table_keys_open}
      </div>
    </header>
  );
}
