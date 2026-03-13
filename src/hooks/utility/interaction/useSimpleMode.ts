import { useSystemStore } from "@/stores/systemStore";

/** Returns true when the app is in "simple" view mode (non-technical UI). */
export function useSimpleMode(): boolean {
  return useSystemStore((s) => s.viewMode === 'simple');
}
