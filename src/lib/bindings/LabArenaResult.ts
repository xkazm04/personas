import type { LabRunStatus } from "./LabRunStatus";

export interface LabArenaResult {
  id: string;
  runId: string;
  scenarioName: string;
  modelId: string;
  provider: string;
  status: LabRunStatus;
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
