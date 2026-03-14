import { useSystemStore } from "@/stores/systemStore";
import { VIEW_MODES } from "@/lib/constants/uiModes";

/** Returns true when the app is in "dev" view mode (development tools enabled). */
export function useDevMode(): boolean {
  return useSystemStore((s) => s.viewMode === VIEW_MODES.DEV);
}
