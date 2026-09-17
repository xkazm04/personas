import type { ReactNode } from 'react';
import { motion } from 'framer-motion';
import { useMotion } from '@/hooks/utility/interaction/useMotion';
import { MOTION_PRESETS, REDUCED_FRAMER } from '@/lib/utils/animation/animationPresets';
import type { CreateAthenaEngine } from '../../engine/createAthenaTypes';
import { IntroCard } from './IntroCard';
import { KeepToggleCard } from './KeepToggleCard';
import { OrbPlaceCard } from './OrbPlaceCard';
import { EnginePickCard } from './EnginePickCard';
import { InstallCard } from './InstallCard';
import { VoicePickCard } from './VoicePickCard';
import { SttCard } from './SttCard';
import { HandoffCard } from './HandoffCard';

/**
 * The user's side of the exchange: one card per `card.kind`, dressed as a
 * slightly narrower right-aligned reply. Every kind is rendered here — a new
 * kind in the contract fails to compile until it has a card.
 */
export function ConversationCard({ engine }: { engine: CreateAthenaEngine }) {
  const { card } = engine;
  const { shouldAnimate } = useMotion();

  let body: ReactNode;
  switch (card.kind) {
    case 'intro':
      body = <IntroCard card={card} engine={engine} />;
      break;
    case 'keep_toggle':
      body = <KeepToggleCard card={card} engine={engine} />;
      break;
    case 'orb_place':
      body = <OrbPlaceCard card={card} engine={engine} />;
      break;
    case 'engine_pick':
      body = <EnginePickCard card={card} engine={engine} />;
      break;
    case 'install':
      body = <InstallCard card={card} engine={engine} />;
      break;
    case 'voice_pick':
      body = <VoicePickCard card={card} engine={engine} />;
      break;
    case 'stt':
      body = <SttCard card={card} engine={engine} />;
      break;
    case 'handoff':
      body = <HandoffCard card={card} engine={engine} />;
      break;
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{
        opacity: 1,
        y: 0,
        transition: shouldAnimate ? MOTION_PRESETS.gentle.framer : REDUCED_FRAMER,
      }}
      className="w-full max-w-[560px] rounded-card bg-primary/10 border border-primary/25 p-4 flex flex-col gap-3"
      data-testid={`create-athena-card-${card.kind}`}
    >
      {body}
    </motion.div>
  );
}
