// Shared types for the ExportSelectionModal picker (Manifest layout).
import type { Persona } from '@/lib/bindings/Persona';
import type { PersonaTeam } from '@/lib/bindings/PersonaTeam';
import type { PersonaCredential } from '@/lib/bindings/PersonaCredential';
import type { DevProject } from '@/lib/bindings/DevProject';
import type { DevWorkspace } from '@/lib/bindings/DevWorkspace';
import type { TwinProfile } from '@/lib/bindings/TwinProfile';
import type { AthenaTier, ExportSelectionArgs } from '@/api/system/dataPortability';

export type { AthenaTier, ExportSelectionArgs };

/** The seven user-pickable categories. KPIs are NOT pickable on their own —
 *  they ride along with their team via the all-or-none `includeKpiSetup` flag.
 *  `projects` = Dev Tools projects; `knowledge` = workspaces whose knowledge
 *  library ships (workspace ids over IPC); `twins` = digital-twin profiles and
 *  their brains; `athena` = Athena's own memory, picked by tier.
 *
 *  Every dispatcher over this union is written as an exhaustive `switch` with a
 *  `const _exhaustive: never = kind` guard — adding an eighth kind without a
 *  branch must fail `tsc`, not silently behave as some other scope. */
export type ExportKind = 'personas' | 'teams' | 'credentials' | 'projects' | 'knowledge' | 'twins' | 'athena';

/** Scopes whose payload is passphrase-encrypted (AES-256-GCM envelope, the
 *  same mechanism the credential vault uses). Selecting any of these without
 *  a passphrase blocks the export. */
export const ENCRYPTED_SCOPES = ['twins', 'athena'] as const satisfies readonly ExportKind[];

/** Athena is a singleton, not a list — its "rows" are two fixed tiers with
 *  real counts, given stable synthetic ids so the `Set<string>` selection
 *  machinery works unchanged. */
export interface AthenaTierRow {
  id: AthenaTier;
  /** Item count from `get_export_stats` — there is no list API for this. */
  count: number;
}

export type OnExport = (args: ExportSelectionArgs) => void;

export interface ExportInventory {
  loading: boolean;
  personas: Persona[];
  teams: PersonaTeam[];
  credentials: PersonaCredential[];
  projects: DevProject[];
  workspaces: DevWorkspace[];
  twins: TwinProfile[];
  /** Only tiers that actually hold something — an empty tier is not a row. */
  athenaTiers: AthenaTierRow[];
  /** twin.id → distilled-fact count (what ships with the twin's brain). */
  twinFactCount: Map<string, number>;
  /** personaId → the teams it belongs to (membership, not just home team). */
  personaTeams: Map<string, PersonaTeam[]>;
  /** team.id → member persona count. */
  teamMemberCount: Map<string, number>;
  /** team.id → KPI count in that team's project (informational badge). */
  teamKpiCount: Map<string, number>;
  /** team.id → off-track KPI count in that team's project (badge). */
  teamOffTrackCount: Map<string, number>;
  /** Total KPIs eligible to ship (tied to any team's project). */
  eligibleKpiCount: number;
  /** Union of KPI ids across the projects of the given teams. */
  kpiIdsForTeams: (teamIds: Iterable<string>) => string[];
}

export interface ExportPicker {
  inv: ExportInventory;

  selectedPersonas: Set<string>;
  selectedTeams: Set<string>;
  selectedCredentials: Set<string>;
  selectedProjects: Set<string>;
  selectedWorkspaces: Set<string>;
  selectedTwins: Set<string>;
  selectedAthenaTiers: Set<string>;
  includeKpiSetup: boolean;
  includeMemories: boolean;
  passphrase: string;

  isSelected: (kind: ExportKind, id: string) => boolean;
  toggle: (kind: ExportKind, id: string) => void;
  setMany: (kind: ExportKind, ids: string[], on: boolean) => void;
  setIncludeKpiSetup: (v: boolean) => void;
  setIncludeMemories: (v: boolean) => void;
  setPassphrase: (v: string) => void;

  /** Every selectable id per scope — the source for select-all / clear-all and
   *  for `counts`. Typed as a total `Record`, so a new scope cannot be
   *  forgotten here either. */
  allIds: Record<ExportKind, string[]>;
  counts: Record<ExportKind, { selected: number; total: number }>;
  /** KPIs that ship given the current team selection + include toggle. */
  kpiShipCount: number;
  totalSelected: number;
  totalItems: number;
  isFullExport: boolean;
  /** Format check: empty, or at least 8 characters. */
  passphraseValid: boolean;
  /** An encrypted scope has a selection, so a passphrase is mandatory. */
  passphraseRequired: boolean;
  /** Mandatory passphrase absent or too short — the export is blocked. */
  passphraseMissing: boolean;

  /** Fire the consumer export callback with the current selection. */
  commit: () => void;
}
