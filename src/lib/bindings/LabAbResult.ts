export interface LabAbResult {
  id: string;
  runId: string;
  versionId: string;
  versionNumber: number;
  scenarioName: string;
  modelId: string;
  provider: string;
  status: string;
  outputPreview: string | null;
  toolCallsExpected: string | null;
  toolCallsActual: string | null;
  toolAccuracyScore: number | null;
  outputQualityScore: number | null;
  protocolCompliance: number | null;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  durationMs: number;
  errorMessage: string | null;
  createdAt: string;
}
