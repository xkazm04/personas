// Shared types for the ExportSelectionModal picker (Manifest layout).
import type { Persona } from '@/lib/bindings/Persona';
import type { PersonaTeam } from '@/lib/bindings/PersonaTeam';
import type { PersonaCredential } from '@/lib/bindings/PersonaCredential';

/** The three user-pickable categories. KPIs are NOT pickable on their own —
 *  they ride along with their team via the all-or-none `includeKpiSetup` flag. */
export type ExportKind = 'personas' | 'teams' | 'credentials';

export type OnExport = (
  personaIds: string[],
  teamIds: string[],
  credentialIds: string[],
  includeMemories: boolean,
  includeKpis: boolean,
  passphrase?: string,
) => void;

export interface ExportInventory {
  loading: boolean;
  personas: Persona[];
  teams: PersonaTeam[];
  credentials: PersonaCredential[];
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
  includeKpiSetup: boolean;
  includeMemories: boolean;
  passphrase: string;

  isSelected: (kind: ExportKind, id: string) => boolean;
  toggle: (kind: ExportKind, id: string) => void;
  setMany: (kind: ExportKind, ids: string[], on: boolean) => void;
  setIncludeKpiSetup: (v: boolean) => void;
  setIncludeMemories: (v: boolean) => void;
  setPassphrase: (v: string) => void;

  counts: Record<ExportKind, { selected: number; total: number }>;
  /** KPIs that ship given the current team selection + include toggle. */
  kpiShipCount: number;
  totalSelected: number;
  totalItems: number;
  isFullExport: boolean;
  passphraseValid: boolean;

  /** Fire the consumer export callback with the current selection. */
  commit: () => void;
}
