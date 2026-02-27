export interface LabMatrixRun {
  id: string;
  personaId: string;
  status: string;
  userInstruction: string;
  draftPromptJson: string | null;
  draftChangeSummary: string | null;
  modelsTested: string;
  scenariosCount: number;
  useCaseFilter: string | null;
  summary: string | null;
  error: string | null;
  draftAccepted: boolean;
  createdAt: string;
  completedAt: string | null;
}
