/**
 * The drafting sheet, version "surface" (moderate; round 2 of spark
 * twin-portable-blueprint): no paper slab. The drawing is inked straight onto
 * the app's content surface; each region is a Personas card whose frame the
 * draw-in traces and then fills, with drafting marks kept as accents only
 * (crop marks at its corners, the bio's dimension line, dashed pending
 * frames, the hatch for "not measured"). Labels are the app's eyebrows and
 * titles, the title block is a Personas strip. No drawn sheet border: there is
 * no sheet. Shared card mechanics: `paperless.css`; the look: `surface.css`.
 */
import type { BlueprintVariantProps } from '../../../blueprintContract';
import DraftingBlueprint from '../index';
import './paperless.css';
import './surface.css';

export default function DraftingSurface(props: BlueprintVariantProps) {
  return <DraftingBlueprint {...props} theme="surface" />;
}
