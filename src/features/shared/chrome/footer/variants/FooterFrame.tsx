import { FooterSlot } from '../FooterSlot';
import { FooterSectionNav, RadioFooter } from '../lazyFooterIcons';

// PROTOTYPE (footer variants): what DesktopFooter knows and every variant needs.

export interface FooterModel {
  /** Stacking class: above the fleet grid / notepad layers while they are up. */
  z: string;
  fleetGridOpen: boolean;
  radioEnabled: boolean;
  athenaEnabled: boolean;
}

/**
 * Absolute-centred middle: section nav while the fleet grid covers the
 * sidebar, else the radio when it is on. Identical in every variant.
 */
export function FooterCenter({ model }: { model: FooterModel }) {
  if (!model.fleetGridOpen && !model.radioEnabled) return null;
  return (
    <div className="absolute left-1/2 -translate-x-1/2 flex items-center">
      <FooterSlot reserve={false}>{model.fleetGridOpen ? <FooterSectionNav /> : <RadioFooter />}</FooterSlot>
    </div>
  );
}
