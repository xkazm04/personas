import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useSystemStore } from '@/stores/systemStore';
import { useCompanionStore } from '../companionStore';
import { useHoldToTalk } from '../useHoldToTalk';
import { AthenaOrb } from './AthenaOrb';

/**
 * Root-level host for Athena's floating orb. Mounted once in `App.tsx` (next
 * to `CompanionPanel`) and portal'd to `document.body` so the orb floats
 * above app content and survives route changes without re-mounting (its
 * video loop keeps running).
 *
 * The orb is shown only while `companionState === 'minimized'`. When the orb
 * feature is enabled and Athena is otherwise dormant (`collapsed`), this
 * promotes her to `minimized` once on mount so the presence is there from
 * launch; the user can dismiss it (→ `collapsed`) and it stays dismissed for
 * the session. The full chat (`open`) and disabled-orb paths render nothing.
 *
 * The single `useHoldToTalk` instance lives here (not in `AthenaOrb`) so the
 * orb's pointer gestures AND the global keyboard shortcut drive the same
 * dictation session — sharing one source of `talking`/caption state.
 */
export default function AthenaOrbLayer() {
  const orbEnabled = useSystemStore((s) => s.companionOrbEnabled);
  const state = useCompanionStore((s) => s.state);
  const setState = useCompanionStore((s) => s.setState);
  const talk = useHoldToTalk();

  // Surface the orb on launch when enabled and Athena is dormant.
  useEffect(() => {
    if (orbEnabled && useCompanionStore.getState().state === 'collapsed') {
      setState('minimized');
    }
  }, [orbEnabled, setState]);

  // Global hotkey: Cmd/Ctrl+Shift+A summons Athena and starts a voice turn
  // (press again to send; Esc to cancel). With the orb disabled it toggles
  // the chat panel instead. The listener is always mounted (this effect runs
  // before the render-time early return), so the shortcut works even while
  // Athena is dormant.
  const { talking, start, stop, abort, supported } = talk;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.shiftKey && (e.key === 'a' || e.key === 'A')) {
        e.preventDefault();
        if (!orbEnabled) {
          const cur = useCompanionStore.getState().state;
          setState(cur === 'open' ? 'collapsed' : 'open');
          return;
        }
        if (talking) {
          stop();
          return;
        }
        if (useCompanionStore.getState().state !== 'minimized') {
          setState('minimized');
        }
        if (supported) start();
        return;
      }
      if (e.key === 'Escape' && talking) {
        abort();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [orbEnabled, talking, supported, start, stop, abort, setState]);

  if (!orbEnabled || state !== 'minimized') return null;

  return createPortal(
    <div
      className="pointer-events-none fixed inset-0 z-50"
      aria-live="polite"
      data-testid="companion-orb-layer"
    >
      <AthenaOrb talk={talk} />
    </div>,
    document.body,
  );
}
