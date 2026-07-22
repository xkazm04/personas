// "Hex Puzzle" — projects as interlocking honeycombs. Thin wrapper: all
// canvas machinery (sea, camera, routes, groups, zoom badge) lives in
// CanvasShell; this variant only supplies the island renderer.
import { CanvasShell } from '../lib/CanvasShell';
import type { VariantProps } from '../lib/types';
import { MosaicIsland } from './MosaicIsland';

export function MastermindHexMosaic(props: VariantProps) {
  return (
    <CanvasShell
      {...props}
      renderIsland={(island, ctx) => <MosaicIsland key={island.slug} island={island} {...ctx} />}
    />
  );
}
