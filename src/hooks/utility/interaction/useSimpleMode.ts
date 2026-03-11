import { usePersonaStore } from '@/stores/personaStore';

/** Returns true when the app is in "simple" view mode (non-technical UI). */
export function useSimpleMode(): boolean {
  return usePersonaStore((s) => s.viewMode === 'simple');
}
