// The project switch (dev_projects.enabled, migration e32), read from the
// frontend. A switched-off project OVERRULES every persona homed in its team:
// the backend refuses to start any of them from any trigger, and every surface
// with a persona on/off control disables that control while the project is off.
//
// The persona -> project link is `persona.home_team_id === project.team_id`
// (one team per project), the same join the backend gates use.
import { useCallback } from 'react';
import { useSystemStore } from '@/stores/systemStore';
import { useAgentStore } from '@/stores/agentStore';
import { useTranslation } from '@/i18n/useTranslation';
import { toastCatch } from '@/lib/silentCatch';
import type { DevProject } from '@/lib/bindings/DevProject';

/** The project owning `teamId`, or null (no team, or no project for it). */
export function useProjectForTeam(teamId: string | null | undefined): DevProject | null {
  return useSystemStore((s) => (teamId ? s.projects.find((p) => p.team_id === teamId) ?? null : null));
}

/** The SWITCHED-OFF project a team belongs to, or null when it may run. */
export function useOffProjectForTeam(teamId: string | null | undefined): DevProject | null {
  const project = useProjectForTeam(teamId);
  return project && !project.enabled ? project : null;
}

/** The SWITCHED-OFF project a persona is homed in, or null when it may run. */
export function useOffProjectForPersona(personaId: string | null | undefined): DevProject | null {
  const teamId = useAgentStore((s) =>
    personaId ? s.personas.find((p) => p.id === personaId)?.home_team_id ?? null : null,
  );
  return useOffProjectForTeam(teamId);
}

/** Flip a project's switch, toasting a failure. */
export function useToggleProject() {
  const { t } = useTranslation();
  const setProjectEnabled = useSystemStore((s) => s.setProjectEnabled);
  return useCallback(
    (project: DevProject) =>
      setProjectEnabled(project.id, !project.enabled).catch(
        toastCatch('projectSwitch:toggle', t.plugins.dev_projects.project_switch_failed),
      ),
    [setProjectEnabled, t],
  );
}
