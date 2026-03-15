import { useSystemStore } from "@/stores/systemStore";
import { TIERS } from "@/lib/constants/uiModes";

/** @deprecated Use `useTier().isStarter` instead. */
export function useSimpleMode(): boolean {
  return useSystemStore((s) => s.viewMode === TIERS.STARTER);
}
