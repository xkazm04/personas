import { useState, useEffect, useMemo, useCallback } from 'react';
import { listPersonas } from '@/api/agents/personas';
import { listCredentials } from '@/api/vault/credentials';
import { listTeams, listTeamMembers } from '@/api/pipeline/teams';
import { listAllKpis } from '@/api/devTools/kpis';
import { listProjects } from '@/api/devTools/devTools';
import { listWorkspaces } from '@/api/devTools/workspaces';
import { kpiTrack } from '@/features/teams/sub_kpis/kpiMath';
import { silentCatch } from '@/lib/silentCatch';
import type { Persona } from '@/lib/bindings/Persona';
import type { PersonaTeam } from '@/lib/bindings/PersonaTeam';
import type { PersonaCredential } from '@/lib/bindings/PersonaCredential';
import type { DevKpi } from '@/lib/bindings/DevKpi';
import type { DevProject } from '@/lib/bindings/DevProject';
import type { DevWorkspace } from '@/lib/bindings/DevWorkspace';
import type { ExportInventory, ExportKind, ExportPicker, OnExport } from './types';

const EMPTY_INVENTORY: ExportInventory = {
  loading: true,
  personas: [],
  teams: [],
  credentials: [],
  projects: [],
  workspaces: [],
  personaTeams: new Map(),
  teamMemberCount: new Map(),
  teamKpiCount: new Map(),
  teamOffTrackCount: new Map(),
  eligibleKpiCount: 0,
  kpiIdsForTeams: () => [],
};

/** Loads the full exportable inventory + relations once per open, and owns the
 *  selection state the modal renders over. KPIs are project-scoped and ride
 *  along with their team — never picked individually. */
export function useExportPicker(isOpen: boolean, onExport: OnExport): ExportPicker {
  const [raw, setRaw] = useState<{
    personas: Persona[];
    teams: PersonaTeam[];
    credentials: PersonaCredential[];
    kpis: DevKpi[];
    projects: DevProject[];
    workspaces: DevWorkspace[];
    memberMap: Map<string, string[]>; // teamId → personaIds
  } | null>(null);
  const [loading, setLoading] = useState(true);

  const [selectedPersonas, setSelectedPersonas] = useState<Set<string>>(new Set());
  const [selectedTeams, setSelectedTeams] = useState<Set<string>>(new Set());
  const [selectedCredentials, setSelectedCredentials] = useState<Set<string>>(new Set());
  const [selectedProjects, setSelectedProjects] = useState<Set<string>>(new Set());
  const [selectedWorkspaces, setSelectedWorkspaces] = useState<Set<string>>(new Set());
  const [includeKpiSetup, setIncludeKpiSetup] = useState(true);
  const [includeMemories, setIncludeMemories] = useState(true);
  const [passphrase, setPassphrase] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setLoading(true);
    setPassphrase('');
    setIncludeMemories(true);
    setIncludeKpiSetup(true);

    (async () => {
      const [personas, teams, credentials, kpis, projects, workspaces] = await Promise.all([
        listPersonas().catch((e) => {
          silentCatch('useExportPicker:listPersonas')(e);
          return [] as Persona[];
        }),
        listTeams().catch((e) => {
          silentCatch('useExportPicker:listTeams')(e);
          return [] as PersonaTeam[];
        }),
        listCredentials().catch((e) => {
          silentCatch('useExportPicker:listCredentials')(e);
          return [] as PersonaCredential[];
        }),
        listAllKpis().catch((e) => {
          silentCatch('useExportPicker:listAllKpis')(e);
          return [] as DevKpi[];
        }),
        listProjects().catch((e) => {
          silentCatch('useExportPicker:listProjects')(e);
          return [] as DevProject[];
        }),
        listWorkspaces().catch((e) => {
          silentCatch('useExportPicker:listWorkspaces')(e);
          return [] as DevWorkspace[];
        }),
      ]);

      const memberLists = await Promise.all(
        teams.map((t) =>
          listTeamMembers(t.id)
            .then((ms) => [t.id, ms.map((m) => m.persona_id)] as const)
            .catch((e) => {
              silentCatch('useExportPicker:listTeamMembers')(e);
              return [t.id, [] as string[]] as const;
            }),
        ),
      );
      const memberMap = new Map<string, string[]>(memberLists);

      if (cancelled) return;
      setRaw({ personas, teams, credentials, kpis, projects, workspaces, memberMap });
      setSelectedPersonas(new Set(personas.map((p) => p.id)));
      setSelectedTeams(new Set(teams.map((t) => t.id)));
      setSelectedCredentials(new Set(credentials.map((c) => c.id)));
      setSelectedProjects(new Set(projects.map((p) => p.id)));
      setSelectedWorkspaces(new Set(workspaces.map((w) => w.id)));
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  const inv: ExportInventory = useMemo(() => {
    if (!raw) return EMPTY_INVENTORY;
    const { personas, teams, credentials, kpis, projects, workspaces, memberMap } = raw;

    // personaId → teams (membership-based).
    const personaTeams = new Map<string, PersonaTeam[]>();
    for (const team of teams) {
      for (const pid of memberMap.get(team.id) ?? []) {
        const arr = personaTeams.get(pid) ?? [];
        arr.push(team);
        personaTeams.set(pid, arr);
      }
    }

    // KPIs are project-scoped; a team's "KPI setup" is its project's KPIs.
    const kpisByProject = new Map<string, DevKpi[]>();
    for (const k of kpis) {
      const arr = kpisByProject.get(k.project_id) ?? [];
      arr.push(k);
      kpisByProject.set(k.project_id, arr);
    }

    const teamMemberCount = new Map<string, number>();
    const teamKpiCount = new Map<string, number>();
    const teamOffTrackCount = new Map<string, number>();
    const eligibleProjects = new Set<string>();
    for (const team of teams) {
      teamMemberCount.set(team.id, (memberMap.get(team.id) ?? []).length);
      const pk = team.project_id ? (kpisByProject.get(team.project_id) ?? []) : [];
      teamKpiCount.set(team.id, pk.length);
      teamOffTrackCount.set(team.id, pk.filter((k) => kpiTrack(k) === 'off-track').length);
      if (team.project_id && pk.length > 0) eligibleProjects.add(team.project_id);
    }
    let eligibleKpiCount = 0;
    for (const proj of eligibleProjects) eligibleKpiCount += kpisByProject.get(proj)?.length ?? 0;

    const teamById = new Map(teams.map((t) => [t.id, t]));
    const kpiIdsForTeams = (teamIds: Iterable<string>): string[] => {
      const projects = new Set<string>();
      for (const id of teamIds) {
        const proj = teamById.get(id)?.project_id;
        if (proj) projects.add(proj);
      }
      const ids: string[] = [];
      for (const proj of projects) for (const k of kpisByProject.get(proj) ?? []) ids.push(k.id);
      return ids;
    };

    const sortPersonas = (a: Persona, b: Persona) =>
      Number(b.enabled) - Number(a.enabled) || a.name.localeCompare(b.name);

    return {
      loading: false,
      personas: [...personas].sort(sortPersonas),
      teams: [...teams].sort(
        (a, b) => Number(b.enabled) - Number(a.enabled) || a.name.localeCompare(b.name),
      ),
      credentials: [...credentials].sort((a, b) => a.name.localeCompare(b.name)),
      projects: [...projects].sort((a, b) => a.name.localeCompare(b.name)),
      workspaces: [...workspaces].sort((a, b) => a.name.localeCompare(b.name)),
      personaTeams,
      teamMemberCount,
      teamKpiCount,
      teamOffTrackCount,
      eligibleKpiCount,
      kpiIdsForTeams,
    };
  }, [raw]);

  // ---- selection plumbing -------------------------------------------------

  const setterFor = useCallback(
    (kind: ExportKind): React.Dispatch<React.SetStateAction<Set<string>>> =>
      kind === 'personas'
        ? setSelectedPersonas
        : kind === 'teams'
          ? setSelectedTeams
          : kind === 'credentials'
            ? setSelectedCredentials
            : kind === 'projects'
              ? setSelectedProjects
              : setSelectedWorkspaces,
    [],
  );

  const setFor = useCallback(
    (kind: ExportKind): Set<string> =>
      kind === 'personas'
        ? selectedPersonas
        : kind === 'teams'
          ? selectedTeams
          : kind === 'credentials'
            ? selectedCredentials
            : kind === 'projects'
              ? selectedProjects
              : selectedWorkspaces,
    [selectedPersonas, selectedTeams, selectedCredentials, selectedProjects, selectedWorkspaces],
  );

  const isSelected = useCallback((kind: ExportKind, id: string) => setFor(kind).has(id), [setFor]);

  const toggle = useCallback(
    (kind: ExportKind, id: string) => {
      setterFor(kind)((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    },
    [setterFor],
  );

  const setMany = useCallback(
    (kind: ExportKind, ids: string[], on: boolean) => {
      setterFor(kind)((prev) => {
        const next = new Set(prev);
        if (on) for (const id of ids) next.add(id);
        else for (const id of ids) next.delete(id);
        return next;
      });
    },
    [setterFor],
  );

  const kpiShipCount = useMemo(
    () => (includeKpiSetup ? inv.kpiIdsForTeams(selectedTeams).length : 0),
    [includeKpiSetup, inv, selectedTeams],
  );

  const counts = useMemo(
    () => ({
      personas: { selected: selectedPersonas.size, total: inv.personas.length },
      teams: { selected: selectedTeams.size, total: inv.teams.length },
      credentials: { selected: selectedCredentials.size, total: inv.credentials.length },
      projects: { selected: selectedProjects.size, total: inv.projects.length },
      knowledge: { selected: selectedWorkspaces.size, total: inv.workspaces.length },
    }),
    [selectedPersonas, selectedTeams, selectedCredentials, selectedProjects, selectedWorkspaces, inv],
  );

  const totalItems =
    inv.personas.length +
    inv.teams.length +
    inv.credentials.length +
    inv.projects.length +
    inv.workspaces.length;
  const totalSelected =
    selectedPersonas.size +
    selectedTeams.size +
    selectedCredentials.size +
    selectedProjects.size +
    selectedWorkspaces.size;
  const isFullExport = totalItems > 0 && totalSelected === totalItems;
  const passphraseValid = passphrase.length === 0 || passphrase.length >= 8;

  const commit = useCallback(() => {
    // `includeKpiSetup` (all-or-none) is the user's intent; the Rust
    // export_selective resolves each selected team's project KPIs server-side
    // and bundles them (active/paused only, with capped measurement history).
    onExport(
      Array.from(selectedPersonas),
      Array.from(selectedTeams),
      Array.from(selectedCredentials),
      Array.from(selectedProjects),
      Array.from(selectedWorkspaces),
      includeMemories,
      includeKpiSetup,
      passphrase.length >= 8 ? passphrase : undefined,
    );
  }, [onExport, selectedPersonas, selectedTeams, selectedCredentials, selectedProjects, selectedWorkspaces, includeMemories, includeKpiSetup, passphrase]);

  return {
    inv: { ...inv, loading: loading || inv.loading },
    selectedPersonas,
    selectedTeams,
    selectedCredentials,
    selectedProjects,
    selectedWorkspaces,
    includeKpiSetup,
    includeMemories,
    passphrase,
    isSelected,
    toggle,
    setMany,
    setIncludeKpiSetup,
    setIncludeMemories,
    setPassphrase,
    counts,
    kpiShipCount,
    totalSelected,
    totalItems,
    isFullExport,
    passphraseValid,
    commit,
  };
}
