import type { LabRunStatus } from "./LabRunStatus";

export interface LabAbRun {
  id: string;
  personaId: string;
  status: LabRunStatus;
  versionAId: string;
  versionBId: string;
  versionANum: number;
  versionBNum: number;
  modelsTested: string;
  scenariosCount: number;
  useCaseFilter: string | null;
  testInput: string | null;
  summary: string | null;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
}
