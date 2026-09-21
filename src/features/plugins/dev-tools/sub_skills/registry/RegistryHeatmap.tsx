// TEMPORARY — /contest host wrapper. Renders whichever heatmap variant the
// shared switch holds (see variants/heatmapVariant.tsx). Each variant keeps
// its own props; this wrapper accepts the union and hands each what it reads.
import { HeatmapVariantFrame } from './variants/heatmapVariant';
import { RegistryHeatmap as CurrentHeatmap } from './variants/current/RegistryHeatmap';
import { RegistryHeatmap as GrokHeatmap } from './variants/grok/RegistryHeatmap';
import { RegistryHeatmap as OpusHeatmap } from './variants/opus/RegistryHeatmap';
import type { SkillsRegistryProps } from './registryTypes';

const noop = () => {};

export function RegistryHeatmap(props: SkillsRegistryProps) {
  return (
    <HeatmapVariantFrame className="h-full">
      {(variant) => (
        <>
          {variant === 'opus5' && <OpusHeatmap {...props} />}
          {variant === 'grok46' && <GrokHeatmap {...props} />}
          {variant === 'current' && <CurrentHeatmap {...props} onOpenInfo={props.onOpenInfo ?? noop} />}
        </>
      )}
    </HeatmapVariantFrame>
  );
}
