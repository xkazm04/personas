// What every preset is handed about its step's detail read. A type-only
// module, so the step screen can name it without pulling a preset chunk in.
import type { LifecycleStepDetail } from '@/lib/bindings/LifecycleStepDetail';

export interface PresetData {
  detail: LifecycleStepDetail | null;
  /** First load in flight with nothing warm to show. */
  loading: boolean;
  /** The detail read failed and nothing warm is on screen. */
  unavailable: boolean;
}
