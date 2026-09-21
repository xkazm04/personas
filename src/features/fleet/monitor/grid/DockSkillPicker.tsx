// TEMPORARY — /contest host wrapper. The dock's skill picker in whichever
// variant the shared switch holds (see
// dev-tools/sub_skills/registry/variants/heatmapVariant.tsx). Each variant is
// the whole popover — its own title bar and its own heatmap — because the
// picker chrome was part of what the contestants redesigned.
import { HeatmapVariantFrame } from '@/features/plugins/dev-tools/sub_skills/registry/variants/heatmapVariant';
import { DockSkillPicker as CurrentPicker } from '@/features/plugins/dev-tools/sub_skills/registry/variants/current/DockSkillPicker';
import { DockSkillPicker as GrokPicker } from '@/features/plugins/dev-tools/sub_skills/registry/variants/grok/DockSkillPicker';
import { DockSkillPicker as OpusPicker, type DockSkillPickerProps } from '@/features/plugins/dev-tools/sub_skills/registry/variants/opus/DockSkillPicker';

export type { DockSkillPickerProps };

export function DockSkillPicker(props: DockSkillPickerProps) {
  // The picker closes on a document mousedown outside its own box; the switch
  // sits above that box, so it keeps its presses to itself.
  return (
    <HeatmapVariantFrame isolateSwitch>
      {(variant) => (
        <>
          {variant === 'opus5' && <OpusPicker {...props} />}
          {variant === 'grok46' && <GrokPicker {...props} />}
          {variant === 'current' && <CurrentPicker {...props} />}
        </>
      )}
    </HeatmapVariantFrame>
  );
}
