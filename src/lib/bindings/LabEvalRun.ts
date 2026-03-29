import type { LabRunStatus } from "./LabRunStatus";

export interface LabEvalRun {
  id: string;
  personaId: string;
  status: LabRunStatus;
  versionIds: string[];
  versionNumbers: number[];
  modelsTested: string[];
  scenariosCount: number;
  useCaseFilter: string | null;
  testInput: string | null;
  summary: string | null;
  llmSummary: string | null;
  progressJson: string | null;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
}
