/**
 * SetupPage — what TwinPage mounts for the Setup module.
 *
 * It owns nothing but the wiring: the session engine and the voice engine are
 * hooks (built in the parallel work package against `setupContract.ts`), and
 * everything visible belongs to `SetupShell` and the variant it renders. Keep
 * it that way — a page that grows logic is a page the four prototype variants
 * start disagreeing about.
 */

import { useSetupSession } from './useSetupSession';
import { useSetupVoice } from './useSetupVoice';
import { SetupShell } from './SetupShell';
import type { TwinSlotId } from '../shared/twinStatus';

interface SetupPageProps {
  /** Jump a readiness click to a slot that lives in the Hub, not in Setup. */
  onOpenHub?: (slot: TwinSlotId) => void;
}

export default function SetupPage({ onOpenHub }: SetupPageProps) {
  const session = useSetupSession();
  // The voice engine needs the flow it is speaking for: the question to read
  // aloud, and where a final transcript goes when hands-free is on.
  const voice = useSetupVoice(session);

  return <SetupShell session={session} voice={voice} onOpenHub={onOpenHub ?? (() => {})} />;
}
