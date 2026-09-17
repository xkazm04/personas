import { useState, useEffect, useMemo, useCallback } from 'react';
import { listPersonas } from '@/api/agents/personas';
import { listCredentials } from '@/api/vault/credentials';
import { listTeams, listTeamMembers } from '@/api/pipeline/teams';
import { listAllKpis } from '@/api/devTools/kpis';
import { listProjects } from '@/api/devTools/devTools';
import { listWorkspaces } from '@/api/devTools/workspaces';
import { listProfiles as listTwinProfiles } from '@/api/twin/twin';
import { getExportStats } from '@/api/system/dataPortability';
import { kpiTrack } from '@/features/teams/sub_kpis/kpiMath';
import { silentCatch } from '@/lib/silentCatch';
import type { Persona } from '@/lib/bindings/Persona';
import type { PersonaTeam } from '@/lib/bindings/PersonaTeam';
import type { PersonaCredential } from '@/lib/bindings/PersonaCredential';
import type { DevKpi } from '@/lib/bindings/DevKpi';
import type { DevProject } from '@/lib/bindings/DevProject';
import type { DevWorkspace } from '@/lib/bindings/DevWorkspace';
import type { TwinProfile } from '@/lib/bindings/TwinProfile';
import type { ExportStats } from '@/api/system/dataPortability';
import type {
  AthenaTier,
  AthenaTierRow,
  ExportInventory,
  ExportKind,
  ExportPicker,
  OnExport,
} from './types';
import { ENCRYPTED_SCOPES } from './types';

type RawInventory = {
  personas: Persona[];
  teams: PersonaTeam[];
  credentials: PersonaCredential[];
  kpis: DevKpi[];
  projects: DevProject[];
  workspaces: DevWorkspace[];
  twins: TwinProfile[];
  athenaTiers: AthenaTierRow[];
  memberMap: Map<string, string[]>; // teamId → personaIds
  pending: Record<ExportKind, boolean>;
};

function allPending(): Record<ExportKind, boolean> {
  return {
    personas: true,
    teams: true,
    credentials: true,
    projects: true,
    knowledge: true,
    twins: true,
    athena: true,
  };
}

function initialRaw(): RawInventory {
  return {
    personas: [],
    teams: [],
    credentials: [],
    kpis: [],
    projects: [],
    workspaces: [],
    twins: [],
    athenaTiers: [],
    memberMap: new Map(),
    pending: allPending(),
  };
}

/** Athena's two synthetic rows, built from `get_export_stats`. A tier with
 *  nothing in it is dropped rather than shown as a zero row — otherwise every
 *  workspace would carry two permanently-unselectable items and "export
 *  everything" could never be true. */
function athenaRowsFrom(stats: ExportStats | null): AthenaTierRow[] {
  if (!stats) return [];
  const rows: AthenaTierRow[] = [];
  if (stats.athenaCoreCount > 0) rows.push({ id: 'core', count: stats.athenaCoreCount });
  if (stats.athenaLearnedCount > 0) rows.push({ id: 'learned', count: stats.athenaLearnedCount });
  return rows;
}

function scopePending(pending: Record<ExportKind, boolean>): boolean {
  return (Object.keys(pending) as ExportKind[]).some((k) => pending[k]);
}

/** Loads the exportable inventory + relations, publishing each list as its
 *  IPC lands so the modal chrome can paint before the slowest sibling. KPIs
 *  are project-scoped and ride along with their team — never picked
 *  individually. Distilled-fact rows are not fetched: they were dumped only
 *  to take `.length`. */
export function useExportPicker(isOpen: boolean, onExport: OnExport): ExportPicker {
  const [raw, setRaw] = useState<RawInventory>(() => initialRaw());

  const [selectedPersonas, setSelectedPersonas] = useState<Set<string>>(new Set());
  const [selectedTeams, setSelectedTeams] = useState<Set<string>>(new Set());
  const [selectedCredentials, setSelectedCredentials] = useState<Set<string>>(new Set());
  const [selectedProjects, setSelectedProjects] = useState<Set<string>>(new Set());
  const [selectedWorkspaces, setSelectedWorkspaces] = useState<Set<string>>(new Set());
  const [selectedTwins, setSelectedTwins] = useState<Set<string>>(new Set());
  const [selectedAthenaTiers, setSelectedAthenaTiers] = useState<Set<string>>(new Set());
  const [includeKpiSetup, setIncludeKpiSetup] = useState(true);
  const [includeMemories, setIncludeMemories] = useState(true);
  const [passphrase, setPassphrase] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setPassphrase('');
    setIncludeMemories(true);
    setIncludeKpiSetup(true);
    setSelectedTwins(new Set());
    setSelectedAthenaTiers(new Set());
    // Keep already-rendered rows (law 1); only mark scopes in-flight so a
    // cold open ghosts and a reopen refreshes behind the previous list.
    setRaw((prev) => ({ ...prev, pending: allPending() }));

    const settle = (kind: ExportKind, patch: Partial<RawInventory>) => {
      if (cancelled) return;
      setRaw((prev) => ({
        ...prev,
        ...patch,
        pending: { ...prev.pending, [kind]: false },
      }));
    };

    listPersonas()
      .then((personas) => {
        settle('personas', { personas });
        if (!cancelled) setSelectedPersonas(new Set(personas.map((p) => p.id)));
      })
      .catch((e) => {
        silentCatch('useExportPicker:listPersonas')(e);
        settle('personas', { personas: [] });
      });

    listTeams()
      .then((teams) => {
        settle('teams', { teams });
        if (cancelled) return;
        setSelectedTeams(new Set(teams.map((t) => t.id)));
        for (const t of teams) {
          listTeamMembers(t.id)
            .then((ms) => {
              if (cancelled) return;
              setRaw((prev) => {
                const memberMap = new Map(prev.memberMap);
                memberMap.set(t.id, ms.map((m) => m.persona_id));
                return { ...prev, memberMap };
              });
            })
            .catch((e) => {
              silentCatch('useExportPicker:listTeamMembers')(e);
              if (cancelled) return;
              setRaw((prev) => {
                const memberMap = new Map(prev.memberMap);
                memberMap.set(t.id, []);
                return { ...prev, memberMap };
              });
            });
        }
      })
      .catch((e) => {
        silentCatch('useExportPicker:listTeams')(e);
        settle('teams', { teams: [] });
      });

    listCredentials()
      .then((credentials) => {
        settle('credentials', { credentials });
        if (!cancelled) setSelectedCredentials(new Set(credentials.map((c) => c.id)));
      })
      .catch((e) => {
        silentCatch('useExportPicker:listCredentials')(e);
        settle('credentials', { credentials: [] });
      });

    listAllKpis()
      .then((kpis) => {
        if (cancelled) return;
        setRaw((prev) => ({ ...prev, kpis }));
      })
      .catch((e) => {
        silentCatch('useExportPicker:listAllKpis')(e);
        if (!cancelled) setRaw((prev) => ({ ...prev, kpis: [] }));
      });

    listProjects()
      .then((projects) => {
        settle('projects', { projects });
        if (!cancelled) setSelectedProjects(new Set(projects.map((p) => p.id)));
      })
      .catch((e) => {
        silentCatch('useExportPicker:listProjects')(e);
        settle('projects', { projects: [] });
      });

    listWorkspaces()
      .then((workspaces) => {
        settle('knowledge', { workspaces });
        if (!cancelled) setSelectedWorkspaces(new Set(workspaces.map((w) => w.id)));
      })
      .catch((e) => {
        silentCatch('useExportPicker:listWorkspaces')(e);
        settle('knowledge', { workspaces: [] });
      });

    listTwinProfiles()
      .then((twins) => {
        settle('twins', { twins });
      })
      .catch((e) => {
        silentCatch('useExportPicker:listTwinProfiles')(e);
        settle('twins', { twins: [] });
      });

    getExportStats()
      .then((stats) => {
        settle('athena', { athenaTiers: athenaRowsFrom(stats) });
      })
      .catch((e) => {
        silentCatch('useExportPicker:getExportStats')(e);
        settle('athena', { athenaTiers: [] });
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  const inv: ExportInventory = useMemo(() => {
    const { personas, teams, credentials, kpis, projects, workspaces, twins, athenaTiers, memberMap, pending } = raw;

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
      loading: scopePending(pending),
      pending,
      personas: [...personas].sort(sortPersonas),
      teams: [...teams].sort(
        (a, b) => Number(b.enabled) - Number(a.enabled) || a.name.localeCompare(b.name),
      ),
      credentials: [...credentials].sort((a, b) => a.name.localeCompare(b.name)),
      projects: [...projects].sort((a, b) => a.name.localeCompare(b.name)),
      workspaces: [...workspaces].sort((a, b) => a.name.localeCompare(b.name)),
      twins: [...twins].sort((a, b) => Number(b.is_active) - Number(a.is_active) || a.name.localeCompare(b.name)),
      athenaTiers,
      twinFactCount: new Map(),
      personaTeams,
      teamMemberCount,
      teamKpiCount,
      teamOffTrackCount,
      eligibleKpiCount,
      kpiIdsForTeams,
    };
  }, [raw]);

  // ---- selection plumbing -------------------------------------------------
  //
  // `setterFor` / `setFor` are exhaustive switches on purpose. They used to be
  // ternary chains whose final `else` returned the workspace set, which meant a
  // newly added ExportKind compiled clean and silently mutated the wrong scope.

  const setterFor = useCallback(
    (kind: ExportKind): React.Dispatch<React.SetStateAction<Set<string>>> => {
      switch (kind) {
        case 'personas': return setSelectedPersonas;
        case 'teams': return setSelectedTeams;
        case 'credentials': return setSelectedCredentials;
        case 'projects': return setSelectedProjects;
        case 'knowledge': return setSelectedWorkspaces;
        case 'twins': return setSelectedTwins;
        case 'athena': return setSelectedAthenaTiers;
        default: {
          const _exhaustive: never = kind;
          return _exhaustive;
        }
      }
    },
    [],
  );

  const setFor = useCallback(
    (kind: ExportKind): Set<string> => {
      switch (kind) {
        case 'personas': return selectedPersonas;
        case 'teams': return selectedTeams;
        case 'credentials': return selectedCredentials;
        case 'projects': return selectedProjects;
        case 'knowledge': return selectedWorkspaces;
        case 'twins': return selectedTwins;
        case 'athena': return selectedAthenaTiers;
        default: {
          const _exhaustive: never = kind;
          return _exhaustive;
        }
      }
    },
    [selectedPersonas, selectedTeams, selectedCredentials, selectedProjects, selectedWorkspaces, selectedTwins, selectedAthenaTiers],
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

  // A total `Record<ExportKind, …>` — omitting a scope is a compile error, so
  // select-all/clear-all and the tallies can never miss one.
  const allIds: Record<ExportKind, string[]> = useMemo(
    () => ({
      personas: inv.personas.map((x) => x.id),
      teams: inv.teams.map((x) => x.id),
      credentials: inv.credentials.map((x) => x.id),
      projects: inv.projects.map((x) => x.id),
      knowledge: inv.workspaces.map((x) => x.id),
      twins: inv.twins.map((x) => x.id),
      athena: inv.athenaTiers.map((x) => x.id),
    }),
    [inv],
  );

  const counts: Record<ExportKind, { selected: number; total: number }> = useMemo(
    () => ({
      personas: { selected: selectedPersonas.size, total: allIds.personas.length },
      teams: { selected: selectedTeams.size, total: allIds.teams.length },
      credentials: { selected: selectedCredentials.size, total: allIds.credentials.length },
      projects: { selected: selectedProjects.size, total: allIds.projects.length },
      knowledge: { selected: selectedWorkspaces.size, total: allIds.knowledge.length },
      twins: { selected: selectedTwins.size, total: allIds.twins.length },
      athena: { selected: selectedAthenaTiers.size, total: allIds.athena.length },
    }),
    [selectedPersonas, selectedTeams, selectedCredentials, selectedProjects, selectedWorkspaces, selectedTwins, selectedAthenaTiers, allIds],
  );

  const { totalItems, totalSelected } = useMemo(() => {
    let items = 0;
    let selected = 0;
    for (const c of Object.values(counts)) {
      items += c.total;
      selected += c.selected;
    }
    return { totalItems: items, totalSelected: selected };
  }, [counts]);

  const isFullExport = totalItems > 0 && totalSelected === totalItems;
  const passphraseValid = passphrase.length === 0 || passphrase.length >= 8;
  const passphraseRequired = ENCRYPTED_SCOPES.some((k) => counts[k].selected > 0);
  const passphraseMissing = passphraseRequired && passphrase.length < 8;

  const commit = useCallback(() => {
    // `includeKpiSetup` (all-or-none) is the user's intent; the Rust
    // export_selective resolves each selected team's project KPIs server-side
    // and bundles them (active/paused only, with capped measurement history).
    onExport({
      personaIds: Array.from(selectedPersonas),
      teamIds: Array.from(selectedTeams),
      credentialIds: Array.from(selectedCredentials),
      projectIds: Array.from(selectedProjects),
      workspaceIds: Array.from(selectedWorkspaces),
      twinIds: Array.from(selectedTwins),
      athenaTiers: Array.from(selectedAthenaTiers) as AthenaTier[],
      includeMemories,
      includeKpis: includeKpiSetup,
      passphrase: passphrase.length >= 8 ? passphrase : undefined,
    });
  }, [onExport, selectedPersonas, selectedTeams, selectedCredentials, selectedProjects, selectedWorkspaces, selectedTwins, selectedAthenaTiers, includeMemories, includeKpiSetup, passphrase]);

  return {
    inv,
    selectedPersonas,
    selectedTeams,
    selectedCredentials,
    selectedProjects,
    selectedWorkspaces,
    selectedTwins,
    selectedAthenaTiers,
    includeKpiSetup,
    includeMemories,
    passphrase,
    isSelected,
    toggle,
    setMany,
    setIncludeKpiSetup,
    setIncludeMemories,
    setPassphrase,
    allIds,
    counts,
    kpiShipCount,
    totalSelected,
    totalItems,
    isFullExport,
    passphraseValid,
    passphraseRequired,
    passphraseMissing,
    commit,
  };
}
