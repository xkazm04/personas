// "Inverse Grid" (round 3, replaces Archipelago) — the grid turned inside
// out: core in the CENTER cell, a layer of dimension tiles around it. Thin
// wrapper over CanvasShell; only the island renderer differs.
import { CanvasShell } from '../lib/CanvasShell';
import type { VariantProps } from '../lib/types';
import { InverseIsland } from './InverseIsland';

export function MastermindInverseGrid(props: VariantProps) {
  return (
    <CanvasShell
      {...props}
      renderIsland={(island, ctx) => <InverseIsland key={island.slug} island={island} {...ctx} />}
    />
  );
}
