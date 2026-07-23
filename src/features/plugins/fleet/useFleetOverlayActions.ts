import { useCallback, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useSystemStore } from '@/stores/systemStore';
import { useCompanionStore } from '@/features/plugins/companion/companionStore';
import { companionApproveAction, companionRejectAction, companionSendMessage } from '@/api/companion';
import { spawnSession, killSession, writeInput } from '@/api/fleet/fleet';
import type { FleetSession } from '@/lib/bindings/FleetSession';
import { useToastStore } from '@/stores/toastStore';
import { toastCatch } from '@/lib/silentCatch';
import { useTranslation } from '@/i18n/useTranslation';
import { craftStalePrompt } from './fleetAttention';
import { gridSessions } from './fleetSessionScope';

/**
 * Everything the fullscreen terminal grid needs to act on the fleet.
 *
 * The overlay is mounted app-wide (`FleetGridLayer`) so it can be raised from
 * the footer on any page, while the Sessions page drives the same operations
 * from its own chrome. Both consume this hook, so "spawn", "kill", "approve
 * Athena's suggestion" and "apply a skill" behave identically no matter which
 * surface triggered them — and there is exactly one place to change them.
 */
export function useFleetOverlayActions() {
  const sessions = useSystemStore(useShallow((s) => s.fleetSessions));
  const refresh = useSystemStore((s) => s.fleetRefresh);
  const activeSessionId = useSystemStore((s) => s.fleetActiveSessionId);
  const setActiveSession = useSystemStore((s) => s.fleetSetActiveSession);
  const activeProjectId = useSystemStore((s) => s.activeProjectId);
  const projects = useSystemStore(useShallow((s) => s.projects));
  const approvals = useCompanionStore(useShallow((s) => s.approvals));
  const removeApproval = useCompanionStore((s) => s.removeApproval);
  const addToast = useToastStore((s) => s.addToast);
  const { t, tx } = useTranslation();

  const [spawning, setSpawning] = useState(false);
  /** Sessions with an in-flight "Ask Athena" turn — drives the tile spinner. */
  const [askingAthena, setAskingAthena] = useState<Set<string>>(new Set());

  const activeProject = useMemo(
    () => (activeProjectId ? projects.find((p) => p.id === activeProjectId) : null) ?? null,
    [activeProjectId, projects],
  );

  /** Tileable sessions in locked spawn order — what the grid renders. */
  const liveSessions = useMemo(() => gridSessions(sessions), [sessions]);

  const handleSpawn = useCallback(async () => {
    if (!activeProject || spawning) return;
    setSpawning(true);
    try {
      const id = await spawnSession(activeProject.root_path);
      setActiveSession(id);
      refresh();
    } catch (e) {
      toastCatch('useFleetOverlayActions:spawn', 'Failed to spawn Claude Code session')(e);
    } finally {
      setSpawning(false);
    }
  }, [activeProject, spawning, refresh, setActiveSession]);

  const handleKill = useCallback(async (id: string) => {
    try {
      await killSession(id);
    } catch (e) {
      toastCatch('useFleetOverlayActions:kill', 'Failed to kill session')(e);
    }
  }, []);

  const handleApprove = useCallback(async (id: string) => {
    try {
      await companionApproveAction(id);
      removeApproval(id);
    } catch (e) {
      toastCatch('useFleetOverlayActions:approve', 'Failed to approve action')(e);
    }
  }, [removeApproval]);

  const handleReject = useCallback(async (id: string) => {
    try {
      await companionRejectAction(id);
      removeApproval(id);
    } catch (e) {
      toastCatch('useFleetOverlayActions:reject', 'Failed to reject action')(e);
    }
  }, [removeApproval]);

  // Ask Athena to reason about one stale session and (if there's a clear
  // winner) propose the next step. Tagged as a Fleet-originated request so it
  // persists as a System turn, never an impersonated user message.
  const handleAskAthena = useCallback(async (session: FleetSession) => {
    setAskingAthena((prev) => new Set(prev).add(session.id));
    try {
      await companionSendMessage(craftStalePrompt(session), false, false, false, 'Fleet');
    } catch (e) {
      toastCatch('useFleetOverlayActions:askAthena', 'Failed to reach Athena')(e);
    } finally {
      setAskingAthena((prev) => {
        const next = new Set(prev);
        next.delete(session.id);
        return next;
      });
    }
  }, []);

  /** Apply a library skill to the focused session — writes `<command>⏎` to its PTY. */
  const handleApplySkill = useCallback(async (command: string) => {
    if (!activeSessionId || !command.trim()) return;
    try {
      await writeInput(activeSessionId, `${command}\r`);
      const sess = sessions.find((s) => s.id === activeSessionId);
      addToast(
        tx(t.plugins.fleet.skill_applied_toast, { command, name: sess?.name ?? sess?.projectLabel ?? '' }),
        'success',
      );
    } catch (e) {
      toastCatch('useFleetOverlayActions:applySkill', 'Failed to apply skill')(e);
    }
  }, [activeSessionId, sessions, addToast, t, tx]);

  return {
    sessions,
    liveSessions,
    activeSessionId,
    setActiveSession,
    activeProject,
    approvals,
    spawning,
    canSpawn: !!activeProject && !spawning,
    askingAthena,
    handleSpawn,
    handleKill,
    handleApprove,
    handleReject,
    handleAskAthena,
    handleApplySkill,
  };
}
