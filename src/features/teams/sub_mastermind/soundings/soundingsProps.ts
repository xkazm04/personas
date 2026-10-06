// Soundings — the contract with MastermindPage. Its own file so the model hook
// and the view can both name it without one importing the other.
import type { DimNode, Scene } from '../lib/types';
import type { Anchor } from './SoundingsCard';

export interface SoundingsViewProps {
  scene: Scene;
  /** The page's scene has not settled yet (useSceneSettle): the chart shows its
   *  chrome and a loading line, never a ghost of stations it does not have. */
  settling?: boolean;
  onDimOpen: (slug: string, node: DimNode, anchor: Anchor) => void;
  onFleetOpen: (sessionId: string) => void;
  onPersonasOpen: (slug: string, anchor: Anchor) => void;
  onRunnersOpen: (slug: string, anchor: Anchor) => void;
  onShipOpen: (slug: string) => void;
  onFactoryOpen: (slug: string) => void;
  onDispatchFleet: (slug: string) => void;
  onOpenTerminal: (slug: string) => void;
  canOpenTerminal: (slug: string) => boolean;
}
