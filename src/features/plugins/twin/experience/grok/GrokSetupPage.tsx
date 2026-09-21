/**
 * GrokSetupPage (contest variant, was setup/SetupPage) — what TwinPage mounts for the Setup module.
 *
 * The guided table now lives in the full-app experience overlay. This page
 * owns the session (one engine, never two) and auto-opens the overlay; closing
 * it reveals the original shell so the tab is never a dead end.
 */

import { useState } from 'react';
import { useSetupSession } from '../../setup/useSetupSession';
import { useSetupVoice } from '../../setup/useSetupVoice';
import { SetupShell } from '../../setup/SetupShell';
import { TwinExperienceOverlay } from './TwinExperienceOverlay';
import type { TwinSlotId } from '../../shared/twinStatus';

interface SetupPageProps {
  /** Jump a readiness click to a slot that lives in the Hub, not in Setup. */
  onOpenHub?: (slot: TwinSlotId) => void;
}

export default function SetupPage({ onOpenHub }: SetupPageProps) {
  const session = useSetupSession();
  const voice = useSetupVoice(session);
  const [overlay, setOverlay] = useState(true);
  const hub = onOpenHub ?? (() => {});

  return (
    <>
      {!overlay && <SetupShell session={session} voice={voice} onOpenHub={hub} />}
      {overlay && (
        <TwinExperienceOverlay
          mode="train"
          session={session}
          voice={voice}
          onClose={() => setOverlay(false)}
          onOpenHub={hub}
        />
      )}
    </>
  );
}
