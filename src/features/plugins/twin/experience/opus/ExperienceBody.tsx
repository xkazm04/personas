/**
 * The experience's two phases, one surface: CREATE a twin, then TRAIN it at
 * the table — with no page, tab or dialog change between them.
 *
 * A `train` request opens straight on the table for the active twin; with no
 * twin active there is nothing to train, so it opens on create instead.
 */

import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';
import { useSystemStore } from '@/stores/systemStore';
import type { TwinExperienceRequest } from './launcher';
import { CreateStage } from './create/CreateStage';
import { TrainingTable } from './table/TrainingTable';

interface ExperienceBodyProps {
  request: TwinExperienceRequest;
  onClose: () => void;
  onOpenHub: () => void;
}

type Phase = 'create' | 'table';

export default function ExperienceBody({ request, onClose, onOpenHub }: ExperienceBodyProps) {
  const activeTwinId = useSystemStore((s) => s.activeTwinId);
  const reduced = useReducedMotion();
  const [phase, setPhase] = useState<Phase>(() =>
    request.mode === 'create' || !activeTwinId ? 'create' : 'table',
  );
  /** True once a twin was made in this sitting: the table greets it. */
  const [fresh, setFresh] = useState(false);

  const slide = reduced ? 0 : 28;

  return (
    <AnimatePresence mode="wait" initial={false}>
      {phase === 'create' ? (
        <motion.div
          key="create"
          className="flex-1 min-h-0 flex flex-col"
          exit={{ opacity: 0, y: -slide, transition: { duration: 0.22 } }}
        >
          <CreateStage
            onClose={onClose}
            onCreated={() => {
              setFresh(true);
              setPhase('table');
            }}
          />
        </motion.div>
      ) : (
        <motion.div
          key="table"
          className="flex-1 min-h-0 flex flex-col"
          initial={{ opacity: 0, y: slide }}
          animate={{ opacity: 1, y: 0, transition: { duration: 0.32, ease: [0.22, 1, 0.36, 1] } }}
        >
          <TrainingTable
            initialStage={request.mode === 'train' ? request.stage : undefined}
            fresh={fresh}
            onClose={onClose}
            onOpenHub={onOpenHub}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
