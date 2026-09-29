// "Watch in Monitor": open a seat's fleet session in the PersonaMonitor.
import { useSystemStore } from '@/stores/systemStore';

/** Open a fleet session in the PersonaMonitor's Activity (fleet board) view. */
export function openSessionInMonitor(sessionId: string): void {
  // The PersonaMonitor overlay (title bar) is the fleet's home in every build;
  // the standalone grid overlay is dev-only. Its Activity view is the fleet
  // board where contest seats sit in their own per-contest column.
  const sys = useSystemStore.getState();
  sys.fleetSetActiveSession(sessionId);
  sys.setMonitorInitialView('fleet');
  sys.setHeaderOverlay('monitor');
}
