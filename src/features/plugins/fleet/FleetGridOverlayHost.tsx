import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSystemStore } from '@/stores/systemStore';
import { FleetTerminalOverlay } from './FleetTerminalOverlay';
import { SkillLibraryDrawer } from './SkillLibraryDrawer';
import { gcTerminals } from './fleetTerminalManager';
import { useFleetTerminalConfig } from './useFleetTerminalConfig';
import { useFleetOverlayActions } from './useFleetOverlayActions';

/**
 * The grid overlay plus the surfaces it opens, hosted outside any page.
 *
 * Split from `FleetGridLayer` purely so the xterm-bearing import graph loads
 * on first open rather than at app boot. Mounted only while the grid is open,
 * which is also why the terminal-settings bridge and terminal GC live here:
 * both are about live terminals, and there are none to manage otherwise.
 */
export default function FleetGridOverlayHost() {
  const setGridOpen = useSystemStore((s) => s.fleetSetGridOpen);
  const {
    sessions,
    liveSessions,
    activeSessionId,
    selectSession,
    approvals,
    canSpawn,
    askingAthena,
    handleSpawn,
    handleKill,
    handleApprove,
    handleReject,
    handleAskAthena,
    handleApplySkill,
  } = useFleetOverlayActions();

  const [skillsOpen, setSkillsOpen] = useState(false);

  // Keep the persisted font / copy-on-select / theme applied to every live
  // terminal, including the ones this overlay just attached.
  useFleetTerminalConfig();

  // Reap managed terminals whose session left the registry.
  useEffect(() => {
    gcTerminals(new Set(sessions.map((s) => s.id)));
  }, [sessions]);

  const close = useCallback(() => setGridOpen(false), [setGridOpen]);

  const activeSession = useMemo(
    () => sessions.find((s) => s.id === activeSessionId) ?? null,
    [sessions, activeSessionId],
  );

  return (
    <>
      <FleetTerminalOverlay
        open
        sessions={liveSessions}
        activeSessionId={activeSessionId}
        onSelect={selectSession}
        onClose={close}
        approvals={approvals}
        askingSessionIds={askingAthena}
        onApprove={handleApprove}
        onReject={handleReject}
        onAskAthena={handleAskAthena}
        onOpenSkills={() => setSkillsOpen(true)}
        onSpawn={handleSpawn}
        canSpawn={canSpawn}
        onKill={handleKill}
      />
      <SkillLibraryDrawer
        open={skillsOpen}
        onClose={() => setSkillsOpen(false)}
        onApply={handleApplySkill}
        targetLabel={activeSession ? (activeSession.name ?? activeSession.projectLabel) : null}
      />
    </>
  );
}
