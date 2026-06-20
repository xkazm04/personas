import { useState, useEffect, useMemo, useCallback } from 'react';
import { listPersonas } from '@/api/agents/personas';
import { listCredentials } from '@/api/vault/credentials';
import { listTeams, listTeamMembers } from '@/api/pipeline/teams';
import { listAllKpis } from '@/api/devTools/kpis';
import { kpiTrack } from '@/features/teams/sub_kpis/kpiMath';
import { silentCatch } from '@/lib/silentCatch';
import type { Persona } from '@/lib/bindings/Persona';
import type { PersonaTeam } from '@/lib/bindings/PersonaTeam';
import type { PersonaCredential } from '@/lib/bindings/PersonaCredential';
import type { DevKpi } from '@/lib/bindings/DevKpi';
import type { ExportInventory, ExportKind, ExportPicker, OnExport } from './types';

const EMPTY_INVENTORY: ExportInventory = {
  loading: true,
  personas: [],
  teams: [],
  credentials: [],
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
    memberMap: Map<string, string[]>; // teamId → personaIds
  } | null>(null);
  const [loading, setLoading] = useState(true);

  const [selectedPersonas, setSelectedPersonas] = useState<Set<string>>(new Set());
  const [selectedTeams, setSelectedTeams] = useState<Set<string>>(new Set());
  const [selectedCredentials, setSelectedCredentials] = useState<Set<string>>(new Set());
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

    const guard =
      <T,>(label: string, fallback: T) =>
      (e: unknown): T => {
        silentCatch(label)(e);
        return fallback;
      };

    (async () => {
      const [personas, teams, credentials, kpis] = await Promise.all([
        listPersonas().catch(guard('useExportPicker:listPersonas', [] as Persona[])),
        listTeams().catch(guard('useExportPicker:listTeams', [] as PersonaTeam[])),
        listCredentials().catch(guard('useExportPicker:listCredentials', [] as PersonaCredential[])),
        listAllKpis().catch(guard('useExportPicker:listAllKpis', [] as DevKpi[])),
      ]);

      const memberLists = await Promise.all(
        teams.map((t) =>
          listTeamMembers(t.id)
            .then((ms) => [t.id, ms.map((m) => m.persona_id)] as const)
            .catch(() => [t.id, [] as string[]] as const),
        ),
      );
      const memberMap = new Map<string, string[]>(memberLists);

      if (cancelled) return;
      setRaw({ personas, teams, credentials, kpis, memberMap });
      setSelectedPersonas(new Set(personas.map((p) => p.id)));
      setSelectedTeams(new Set(teams.map((t) => t.id)));
      setSelectedCredentials(new Set(credentials.map((c) => c.id)));
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  const inv: ExportInventory = useMemo(() => {
    if (!raw) return EMPTY_INVENTORY;
    const { personas, teams, credentials, kpis, memberMap } = raw;

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
          : setSelectedCredentials,
    [],
  );

  const setFor = useCallback(
    (kind: ExportKind): Set<string> =>
      kind === 'personas'
        ? selectedPersonas
        : kind === 'teams'
          ? selectedTeams
          : selectedCredentials,
    [selectedPersonas, selectedTeams, selectedCredentials],
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
    }),
    [selectedPersonas, selectedTeams, selectedCredentials, inv],
  );

  const totalItems = inv.personas.length + inv.teams.length + inv.credentials.length;
  const totalSelected = selectedPersonas.size + selectedTeams.size + selectedCredentials.size;
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
      includeMemories,
      includeKpiSetup,
      passphrase.length >= 8 ? passphrase : undefined,
    );
  }, [onExport, selectedPersonas, selectedTeams, selectedCredentials, includeMemories, includeKpiSetup, passphrase]);

  return {
    inv: { ...inv, loading: loading || inv.loading },
    selectedPersonas,
    selectedTeams,
    selectedCredentials,
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
