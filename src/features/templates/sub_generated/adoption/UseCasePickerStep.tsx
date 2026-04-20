/**
 * Combined capability + trigger composition step.
 *
 * Neon is the committed styling — Terminal and Blueprint were explored
 * and dropped. This wrapper exists only to keep MatrixAdoptionView's
 * import path stable.
 */
import { UseCasePickerStepNeon } from './UseCasePickerStepNeon';
import type { UseCaseOption, UseCasePickerVariantProps } from './useCasePickerShared';

export type { UseCaseOption };

export function UseCasePickerStep(props: UseCasePickerVariantProps) {
  return <UseCasePickerStepNeon {...props} />;
}
