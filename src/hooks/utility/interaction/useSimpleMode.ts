import { useSystemStore } from "@/stores/systemStore";
import { VIEW_MODES } from "@/lib/constants/uiModes";

/** Returns true when the app is in "simple" view mode (non-technical UI). */
export function useSimpleMode(): boolean {
  return useSystemStore((s) => s.viewMode === VIEW_MODES.SIMPLE);
}
