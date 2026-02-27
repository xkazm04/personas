export interface LabEvalRun {
  id: string;
  personaId: string;
  status: string;
  versionIds: string;
  versionNumbers: string;
  modelsTested: string;
  scenariosCount: number;
  useCaseFilter: string | null;
  testInput: string | null;
  summary: string | null;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
}
