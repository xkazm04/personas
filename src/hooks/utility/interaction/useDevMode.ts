import { useSystemStore } from "@/stores/systemStore";
import { TIERS } from "@/lib/constants/uiModes";

/** @deprecated Use `useTier().isBuilder` instead. */
export function useDevMode(): boolean {
  return useSystemStore((s) => s.viewMode === TIERS.BUILDER);
}
