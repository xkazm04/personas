import type { LabRunStatus } from "./LabRunStatus";

export interface LabMatrixRun {
  id: string;
  personaId: string;
  status: LabRunStatus;
  userInstruction: string;
  draftPromptJson: string | null;
  draftChangeSummary: string | null;
  modelsTested: string[];
  scenariosCount: number;
  useCaseFilter: string | null;
  summary: string | null;
  llmSummary: string | null;
  progressJson: string | null;
  error: string | null;
  draftAccepted: boolean;
  createdAt: string;
  completedAt: string | null;
}
