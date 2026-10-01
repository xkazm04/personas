/**
 * Blueprint variant "radial" (spark twin-portable-blueprint). PLACEHOLDER (WP0):
 * the renderer lands in its own work package. Contract: `BlueprintVariantProps`.
 */
import type { BlueprintVariantProps } from '../../blueprintContract';

export default function RadialBlueprint({ mode, focus }: BlueprintVariantProps) {
  return <div data-testid="twin-blueprint-radial" data-mode={mode} data-focus={focus ?? 'overview'} />;
}
