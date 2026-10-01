/**
 * The blueprint as the training overlay's base layer (spark
 * twin-portable-blueprint): the variant the Detail page's switcher picked, in
 * `stage` mode, filling the table behind the hand. A variant MAY route a
 * section press to `onOpenDetail`, which opens the door that edits it (the
 * same doors the chrome carries); the four prototypes keep stage inert
 * because the hand above owns the keyboard. TODO(prototype, 2026-10-01):
 * settle this at the fusion round.
 *
 * It renders under everything else in the play area and takes no focus of its
 * own; the hand above it owns the keyboard.
 */
import { Suspense } from 'react';

import type { BlueprintDelta, SectionId, TwinBlueprintModel } from './blueprintContract';
import { useBlueprintVariant } from './blueprintVariant';
import { BlueprintGhost } from './BlueprintGhost';
import { BLUEPRINT_VARIANTS } from './variantRegistry';

interface BlueprintStageProps {
  model: TwinBlueprintModel | null;
  delta: BlueprintDelta | null;
  working: boolean;
  reduced: boolean;
  onSection: (section: SectionId) => void;
}

/** Stage mode has no L2: a section is never zoomed into here. */
const NO_FOCUS = () => {};

export function BlueprintStage({ model, delta, working, reduced, onSection }: BlueprintStageProps) {
  const [variant] = useBlueprintVariant();
  const Variant = BLUEPRINT_VARIANTS[variant];

  return (
    <div className="absolute inset-0 flex flex-col" data-testid="twin-blueprint-stage" data-variant={variant}>
      {model ? (
        <Suspense fallback={<BlueprintGhost />}>
          <Variant
            model={model}
            mode="stage"
            focus={null}
            onFocus={NO_FOCUS}
            onOpenDetail={onSection}
            delta={delta}
            working={working}
            reduced={reduced}
          />
        </Suspense>
      ) : (
        <BlueprintGhost />
      )}
    </div>
  );
}

export default BlueprintStage;
