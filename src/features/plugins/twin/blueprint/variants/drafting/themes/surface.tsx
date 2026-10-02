/**
 * The drafting sheet, level 2 "Half and half" (round 3 of spark
 * twin-portable-blueprint, the middle): the blueprint's paper and ink half
 * cyanotype and half theme, its patterns at full strength, and Personas glass
 * cards laid on it for every region and the title block, with the drafting
 * marks (balloons, lettering, hatches, dimension and construction lines) drawn
 * on top of them. Sheet and cards: `sheet.css`; the blue: `cyanotype.css`;
 * the blend: `surface.css`.
 */
import type { BlueprintVariantProps } from '../../../blueprintContract';
import DraftingBlueprint from '../index';
import './sheet.css';
import './cyanotype.css';
import './surface.css';

export default function DraftingSurface(props: BlueprintVariantProps) {
  return <DraftingBlueprint {...props} theme="surface" />;
}
