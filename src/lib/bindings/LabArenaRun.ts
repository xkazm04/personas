import type { LabRunStatus } from "./LabRunStatus";

export interface LabArenaRun {
  id: string;
  personaId: string;
  status: LabRunStatus;
  modelsTested: string[];
  scenariosCount: number;
  useCaseFilter: string | null;
  summary: string | null;
  llmSummary: string | null;
  progressJson: string | null;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
}
