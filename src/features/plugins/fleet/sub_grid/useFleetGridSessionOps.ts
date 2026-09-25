import { useCallback } from 'react';
import { toastCatch } from '@/lib/silentCatch';
import { useSystemStore } from '@/stores/systemStore';
import { useToastStore } from '@/stores/toastStore';
import { spawnSession, spawnHeadlessSession, writeInput, hibernateSession, wakeSession } from '@/api/fleet/fleet';
import type { FleetSession } from '@/lib/bindings/FleetSession';
import { useTranslation } from '@/i18n/useTranslation';
import { replyToSession } from '../replyToSession';

interface Project { root_path: string }

/** The per-session operations the Sessions page offers besides spawn and apply-skill. */
export function useFleetGridSessionOps(
  sessions: FleetSession[],
  activeProject: Project | null,
  setActiveSession: (id: string) => void,
) {
  const refresh = useSystemStore((s) => s.fleetRefresh);
  const addToast = useToastStore((s) => s.addToast);
  const { t, tx } = useTranslation();

  // Inline reply from the "Needs you" banner: the shared gesture writes the
  // line to the session's PTY, carriage return included.
  const handleReply = useCallback(async (id: string, replyText: string) => {
    await replyToSession(id, replyText);
  }, []);

  // Compact a bloated session: write `/compact` + CR into its PTY (claude's
  // native compaction), which cuts per-turn cost for the rest of the run.
  const handleCompact = useCallback(async (id: string) => {
    try {
      await writeInput(id, '/compact\r');
      const sess = sessions.find((s) => s.id === id);
      addToast(tx(t.plugins.fleet.compact_toast, { name: sess?.name ?? sess?.projectLabel ?? '' }), 'success');
    } catch (e) {
      toastCatch('FleetGridPage:compact', 'Failed to compact session')(e);
    }
  }, [sessions, addToast, t, tx]);

  // Hibernate: free the process, keep the row resumable. Wake: respawn
  // `claude --resume` and focus the new session (F3).
  const handleHibernate = useCallback(async (id: string) => {
    try {
      await hibernateSession(id);
    } catch (e) {
      toastCatch('FleetGridPage:hibernate', 'Failed to hibernate session')(e);
    }
  }, []);
  const handleWake = useCallback(async (id: string) => {
    try {
      setActiveSession(await wakeSession(id));
    } catch (e) {
      toastCatch('FleetGridPage:wake', 'Failed to wake session')(e);
    }
  }, [setActiveSession]);

  // Spawn seeded with a first task: the prompt rides as a positional argv, so
  // the session starts working the moment it boots; `headless` routes to the
  // stream-json lane. Returns success so the modal keeps a failed draft.
  const handleSpawnWithTask = useCallback(async (prompt: string, headless: boolean): Promise<boolean> => {
    if (!activeProject) return false;
    try {
      const id = headless
        ? await spawnHeadlessSession(activeProject.root_path, prompt)
        : await spawnSession(activeProject.root_path, [prompt]);
      setActiveSession(id);
      refresh();
      return true;
    } catch (e) {
      toastCatch('FleetGridPage:spawnTask', 'Failed to spawn Claude Code session')(e);
      return false;
    }
  }, [activeProject, refresh, setActiveSession]);

  return { handleReply, handleCompact, handleHibernate, handleWake, handleSpawnWithTask };
}
