import { useTranslation } from '@/i18n/useTranslation';
import type { Difficulty } from '@/lib/bindings/Difficulty';
import type { GpuClass } from '@/lib/bindings/GpuClass';
import type { MachineLoad } from '@/lib/bindings/MachineLoad';

/** The resource profile's tag names, shared by the card's pickers and its measured row. */
export function useProfileLabels() {
  const c = useTranslation().t.agents.responsibilities;
  const machine: Record<MachineLoad, string> = {
    light: c.profile_machine_light,
    moderate: c.profile_machine_moderate,
    heavy: c.profile_machine_heavy,
    exclusive: c.profile_machine_exclusive,
  };
  const gpu: Record<GpuClass, string> = {
    none: c.profile_gpu_none,
    shared: c.profile_gpu_shared,
    exclusive: c.profile_gpu_exclusive,
  };
  const gpuDetail: Record<GpuClass, string> = {
    none: c.profile_gpu_none_detail,
    shared: c.profile_gpu_shared_detail,
    exclusive: c.profile_gpu_exclusive_detail,
  };
  const difficulty: Record<Difficulty, string> = {
    light: c.profile_difficulty_light,
    standard: c.profile_difficulty_standard,
    hard: c.profile_difficulty_hard,
  };
  const reasoning = { low: c.profile_effort_low, medium: c.profile_effort_medium, high: c.profile_effort_high };
  return { machine, gpu, gpuDetail, difficulty, reasoning };
}
