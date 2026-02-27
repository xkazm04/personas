export interface LabArenaRun {
  id: string;
  personaId: string;
  status: string;
  modelsTested: string;
  scenariosCount: number;
  useCaseFilter: string | null;
  summary: string | null;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
}
