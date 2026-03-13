import { useSystemStore } from "@/stores/systemStore";

/** Returns true when the app is in "dev" view mode (development tools enabled). */
export function useDevMode(): boolean {
  return useSystemStore((s) => s.viewMode === 'dev');
}
