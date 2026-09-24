/**
 * Overlay that owns the setup session. Used from the create-twin entry so
 * Profiles does not have to mount `useSetupSession` itself.
 */

import { useSetupSession } from '../../setup/useSetupSession';
import { useSetupVoice } from '../../setup/useSetupVoice';
import { TwinExperienceOverlay } from './TwinExperienceOverlay';
import type { ExperienceMode } from './TwinExperienceHost';
import type { TwinSlotId } from '../../shared/twinStatus';

interface TwinExperienceSelfHostedProps {
  mode: ExperienceMode;
  onClose: () => void;
  onOpenHub?: (slot: TwinSlotId) => void;
}

export function TwinExperienceSelfHosted({
  mode,
  onClose,
  onOpenHub,
}: TwinExperienceSelfHostedProps) {
  const session = useSetupSession();
  const voice = useSetupVoice(session);
  return (
    <TwinExperienceOverlay
      mode={mode}
      session={session}
      voice={voice}
      onClose={onClose}
      onOpenHub={onOpenHub}
    />
  );
}

export default TwinExperienceSelfHosted;
