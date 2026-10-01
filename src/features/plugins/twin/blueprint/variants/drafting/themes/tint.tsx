/**
 * The drafting sheet, theme "tint" (subtle step toward the Personas theme; round 2
 * of spark twin-portable-blueprint). PLACEHOLDER until the theme package lands:
 * renders the baseline sheet.
 */
import type { BlueprintVariantProps } from '../../../blueprintContract';
import DraftingBlueprint from '../index';

export default function DraftingTint(props: BlueprintVariantProps) {
  return <DraftingBlueprint {...props} />;
}
