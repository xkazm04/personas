/**
 * The Mirror's two acts, on one surface: NAME a twin, then ANSWER for it —
 * with no page, tab or dialog change between them.
 *
 * The seam between the two is the point of the whole variant. The create act's
 * sigil disc and the stage rail's sigil disc share one framer `layoutId`, so
 * the thing the person just made physically travels up into the chrome and
 * becomes the identity they are now training. Nothing is torn down and rebuilt
 * in front of them; one object moves and the lane fills in behind it.
 *
 * A `train` request opens straight on the stage for the active twin; with no
 * twin active there is nothing to train, so it opens on the name act instead.
 */

import { useState } from 'react';
import { AnimatePresence, LayoutGroup } from 'framer-motion';
import { useSystemStore } from '@/stores/systemStore';
import type { MirrorRequest } from './launcher';
import { CreateAct } from './create/CreateAct';
import { Stage } from './stage/Stage';

interface MirrorBodyProps {
  request: MirrorRequest;
  onClose: () => void;
  onOpenHub: () => void;
}

type Act = 'create' | 'stage';

export default function MirrorBody({ request, onClose, onOpenHub }: MirrorBodyProps) {
  const activeTwinId = useSystemStore((s) => s.activeTwinId);
  const [act, setAct] = useState<Act>(() =>
    request.mode === 'create' || !activeTwinId ? 'create' : 'stage',
  );
  /** True once a twin was made in this sitting: the first question greets it. */
  const [fresh, setFresh] = useState(false);

  return (
    // Both acts are absolutely positioned in one box and the presence runs in
    // SYNC mode, so for the length of the transition they are BOTH mounted.
    // That overlap is what the shared sigil needs: with `mode="wait"` the old
    // disc would be gone before the new one existed and there would be nothing
    // to travel from. The `LayoutGroup` is what makes the two discs one.
    <LayoutGroup>
      <div className="relative flex-1 min-h-0">
        <AnimatePresence initial={false}>
          {act === 'create' ? (
            <CreateAct
              key="create"
              onClose={onClose}
              onCreated={() => {
                setFresh(true);
                setAct('stage');
              }}
            />
          ) : (
            <Stage
              key="stage"
              initialStage={request.mode === 'train' ? request.stage : undefined}
              fresh={fresh}
              onClose={onClose}
              onOpenHub={onOpenHub}
            />
          )}
        </AnimatePresence>
      </div>
    </LayoutGroup>
  );
}
