import type { ReactNode } from 'react';
import type { CreateAthenaEngine } from '../../engine/createAthenaTypes';
import { IntroCard, OrbPlaceCard, HandoffCard } from './SimpleCards';
import { KeepToggleCard } from './KeepToggleCard';
import { EnginePickCard } from './EnginePickCard';
import { InstallCard } from './InstallCard';
import { VoicePickCard } from './VoicePickCard';
import { SttCard } from './SttCard';

/**
 * The one interactive object of the scene, switched on `card.kind`. Every
 * kind renders — an unknown kind is a compile error, not a blank screen.
 */
export function SceneCard({ engine }: { engine: CreateAthenaEngine }) {
  const { card, actions } = engine;
  let body: ReactNode;
  switch (card.kind) {
    case 'intro':
      body = <IntroCard card={card} actions={actions} />;
      break;
    case 'keep_toggle':
      body = <KeepToggleCard card={card} actions={actions} />;
      break;
    case 'orb_place':
      body = <OrbPlaceCard card={card} actions={actions} />;
      break;
    case 'engine_pick':
      body = <EnginePickCard card={card} actions={actions} />;
      break;
    case 'install':
      body = <InstallCard card={card} actions={actions} />;
      break;
    case 'voice_pick':
      body = <VoicePickCard card={card} actions={actions} />;
      break;
    case 'stt':
      body = <SttCard card={card} actions={actions} />;
      break;
    case 'handoff':
      body = <HandoffCard card={card} actions={actions} />;
      break;
  }
  return <div data-testid={`create-athena-card-${card.kind}`}>{body}</div>;
}
