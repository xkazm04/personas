/**
 * Full-app overlay for twin create + training. A BaseModal popover — not a tab
 * panel and not an `md` dialog.
 *
 * The width is CAPPED, not bled: `min(96vw, 110rem)` keeps it a deliberate
 * centred surface on a wide screen instead of a near-full-bleed box with a
 * hairline of page showing at the edges. Header and composer are pinned by the
 * children; only the table body scrolls.
 */

import { BaseModal } from '@/lib/ui/BaseModal';
import type { TwinSlotId } from '../../shared/twinStatus';
import type { SetupSessionApi, SetupVoiceApi } from '../../setup/setupContract';
import { TwinExperienceHost, type ExperienceMode } from './TwinExperienceHost';

export interface TwinExperienceOverlayProps {
  mode: ExperienceMode;
  session: SetupSessionApi;
  voice: SetupVoiceApi;
  onClose: () => void;
  onOpenHub?: (slot: TwinSlotId) => void;
}

export function TwinExperienceOverlay({
  mode,
  session,
  voice,
  onClose,
  onOpenHub,
}: TwinExperienceOverlayProps) {
  return (
    <BaseModal
      isOpen
      onClose={onClose}
      titleId="twin-experience-title"
      portal
      staggerChildren={false}
      maxWidthClass="max-w-[min(96vw,110rem)]"
      panelClassName="h-[92vh] max-h-[92vh] w-full flex flex-col overflow-hidden rounded-modal glass-lg shadow-elevation-4 border border-primary/20 bg-background"
    >
      <TwinExperienceHost
        mode={mode}
        session={session}
        voice={voice}
        onClose={onClose}
        onOpenHub={onOpenHub ?? (() => {})}
      />
    </BaseModal>
  );
}

export default TwinExperienceOverlay;
