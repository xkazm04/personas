/**
 * The drafting sheet, level 1 "Personas touch" (round 3 of spark
 * twin-portable-blueprint, very subtle): the cyanotype blueprint intact, its
 * fixed blue in every theme, with a Personas touch only: the sheet on a card
 * edge, the app's figures, and the theme's primary as the accent ink of live
 * things. The structure is the baseline's; all of it is CSS
 * (`sheet.css`, `cyanotype.css`, `tint.css`).
 */
import type { BlueprintVariantProps } from '../../../blueprintContract';
import DraftingBlueprint from '../index';
import './sheet.css';
import './cyanotype.css';
import './tint.css';

export default function DraftingTint(props: BlueprintVariantProps) {
  return <DraftingBlueprint {...props} theme="tint" />;
}
