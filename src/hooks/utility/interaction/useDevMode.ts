import { usePersonaStore } from '@/stores/personaStore';

/** Returns true when the app is in "dev" view mode (development tools enabled). */
export function useDevMode(): boolean {
  return usePersonaStore((s) => s.viewMode === 'dev');
}
