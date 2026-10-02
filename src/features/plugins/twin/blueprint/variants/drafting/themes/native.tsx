/**
 * The drafting sheet, level 3 "Personas blueprint" (round 3 of spark
 * twin-portable-blueprint, major): Personas eats the blueprint and makes it
 * its own. No foreign blue: the paper, the grid, the sheet frame, the hatches,
 * the dimension and construction lines are all in the theme's colour, the
 * regions glowing Personas cards named by their icons, the title block the
 * twin's identity card, every state in the app's status roles. It still draws
 * itself in as a blueprint. Sheet and cards: `sheet.css`; the look:
 * `native.css`.
 */
import type { BlueprintVariantProps } from '../../../blueprintContract';
import DraftingBlueprint from '../index';
import './sheet.css';
import './native.css';

export default function DraftingNative(props: BlueprintVariantProps) {
  return <DraftingBlueprint {...props} theme="native" />;
}
