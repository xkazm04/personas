export interface LabResultBase {
  scenarioName: string;
  modelId: string;
  provider: string;
  status: string;
  outputPreview: string | null;
  toolCallsExpected: string[] | null;
  toolCallsActual: string[] | null;
  toolAccuracyScore: number | null;
  outputQualityScore: number | null;
  protocolCompliance: number | null;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  durationMs: number;
  rationale: string | null;
  suggestions: string | null;
  errorMessage: string | null;
  evalMethod: string | null;
  createdAt: string;
}
