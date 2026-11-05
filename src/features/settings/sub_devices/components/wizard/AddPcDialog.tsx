/**
 * The guided "Add a PC" dialog: Find -> Code -> Approve -> Done.
 *
 * CONTRACT STUB (spark device-onboarding, WP0). The page shell (WP3) mounts it
 * with these final props; WP2 fills in the steps. The page owns `open`: it is
 * true while the operator opened it OR a responder request is pending, so the
 * receiving PC lands straight on the Approve step.
 */
import type { useDeviceLink } from '../../lib/useDeviceLink';

export type DeviceLink = ReturnType<typeof useDeviceLink>;

export interface AddPcDialogProps {
  open: boolean;
  onClose: () => void;
  link: DeviceLink;
}

export function AddPcDialog(_props: AddPcDialogProps) {
  return null;
}
