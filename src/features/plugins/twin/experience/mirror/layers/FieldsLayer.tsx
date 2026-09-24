/**
 * Every slot, typed directly — the widest layer, and the way through when the
 * guide is down.
 *
 * `SetupFieldsPage` is the shared editor the other surfaces use; nothing about
 * it is re-implemented here. What this adds is that it arrives as a LAYER,
 * over the question it belongs to, rather than as a tab that replaces the lane
 * — so "let me just type it" never loses the person's place.
 */

import { SlidersHorizontal } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { SetupFieldsPage } from '../../../setup/SetupFieldsPage';
import type { SetupFocus, SetupSessionApi } from '../../../setup/setupContract';
import type { TwinSlotId } from '../../../shared/twinStatus';
import { LayerFrame } from './LayerFrame';

interface FieldsLayerProps {
  open: boolean;
  onClose: () => void;
  session: SetupSessionApi;
  onOpenHub: (slot: TwinSlotId) => void;
  /** "Ask the guide about this instead" — closes the layer and refocuses. */
  onAskGuide: (slot: SetupFocus) => void;
}

export function FieldsLayer({ open, onClose, session, onOpenHub, onAskGuide }: FieldsLayerProps) {
  const { t } = useTranslation();

  return (
    <LayerFrame
      open={open}
      onClose={onClose}
      icon={<SlidersHorizontal className="w-4 h-4" />}
      title={t.twin.setup.fieldsTitle}
      hint={t.twin.setup.fieldsHint}
      width="wide"
      testId="mr-fields"
    >
      <SetupFieldsPage
        session={session}
        values={session.values}
        jump={null}
        onOpenHub={onOpenHub}
        onAskGuide={(slot) => {
          onAskGuide(slot);
          onClose();
        }}
      />
    </LayerFrame>
  );
}

export default FieldsLayer;
