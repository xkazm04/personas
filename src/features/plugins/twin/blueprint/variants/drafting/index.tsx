/**
 * Blueprint variant "drafting" (spark twin-portable-blueprint). PLACEHOLDER (WP0):
 * the renderer lands in its own work package. Contract: `BlueprintVariantProps`.
 */
import type { BlueprintVariantProps } from '../../blueprintContract';

export default function DraftingBlueprint({ mode, focus }: BlueprintVariantProps) {
  return <div data-testid="twin-blueprint-drafting" data-mode={mode} data-focus={focus ?? 'overview'} />;
}
