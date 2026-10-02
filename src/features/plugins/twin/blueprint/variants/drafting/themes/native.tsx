/**
 * The drafting sheet, version "native" (major; round 2 of spark
 * twin-portable-blueprint): the twin drawn in Personas' own language. Section
 * cards carry the theme's glow and gradient and a section icon (the twin's
 * brand glyph on Identity), state is told with the app's status tokens (done
 * in success, in progress in the primary glow, awaiting review in pending,
 * rejected in error, not measured in neutral) and readiness with the twin
 * status vocabulary. Drafting survives in the motion (frames traced, ink run
 * round each card, lettering, the pen) and in two signatures: the bio's
 * dimension line and the hatch. No drawn sheet border: there is no sheet.
 * Shared card mechanics: `paperless.css`; the look: `native.css`.
 */
import type { BlueprintVariantProps } from '../../../blueprintContract';
import DraftingBlueprint from '../index';
import './paperless.css';
import './native.css';

export default function DraftingNative(props: BlueprintVariantProps) {
  return <DraftingBlueprint {...props} theme="native" />;
}
