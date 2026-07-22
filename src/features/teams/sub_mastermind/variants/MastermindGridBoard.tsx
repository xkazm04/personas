// "Grid Board" — projects as rectangular component boards (header + 4×2 tile
// matrix). Thin wrapper over CanvasShell; only the island renderer differs.
import { CanvasShell } from '../lib/CanvasShell';
import type { VariantProps } from '../lib/types';
import { BoardIsland } from './BoardIsland';

export function MastermindGridBoard(props: VariantProps) {
  return (
    <CanvasShell
      {...props}
      renderIsland={(island, ctx) => <BoardIsland key={island.slug} island={island} {...ctx} />}
    />
  );
}
