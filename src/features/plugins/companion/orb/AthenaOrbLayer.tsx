import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useSystemStore } from '@/stores/systemStore';
import { useCompanionStore } from '../companionStore';
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
 */
export default function AthenaOrbLayer() {
  const orbEnabled = useSystemStore((s) => s.companionOrbEnabled);
  const state = useCompanionStore((s) => s.state);
  const setState = useCompanionStore((s) => s.setState);

  // Surface the orb on launch when enabled and Athena is dormant.
  useEffect(() => {
    if (orbEnabled && useCompanionStore.getState().state === 'collapsed') {
      setState('minimized');
    }
  }, [orbEnabled, setState]);

  if (!orbEnabled || state !== 'minimized') return null;

  return createPortal(
    <div
      className="pointer-events-none fixed inset-0 z-50"
      aria-live="polite"
      data-testid="companion-orb-layer"
    >
      <AthenaOrb />
    </div>,
    document.body,
  );
}
