/**
 * The drafting sheet, version "tint" (subtle; round 2 of spark
 * twin-portable-blueprint): the same sheet, lettering and drawing, but the
 * paper and ink are mixed from the active theme only (no fixed cyanotype
 * blue), the grid is quieter, and the sheet's edge is a Personas card (radius,
 * elevation, a primary border and glow). It keeps the drawn border, rounded
 * to sit inside the card. All of it is `tint.css`.
 */
import type { BlueprintVariantProps } from '../../../blueprintContract';
import DraftingBlueprint from '../index';
import './tint.css';

export default function DraftingTint(props: BlueprintVariantProps) {
  return <DraftingBlueprint {...props} theme="tint" />;
}
