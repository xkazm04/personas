export interface LabUserRating {
  id: string;
  runId: string;
  resultId: string | null;
  scenarioName: string;
  rating: number;
  feedback: string | null;
  createdAt: string;
}
