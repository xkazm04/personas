export type AssertionResult = {
  id: string;
  assertionId: string;
  executionId: string;
  personaId: string;
  passed: boolean;
  explanation: string;
  matchedValue: string | null;
  evaluationMs: number;
  createdAt: string;
};
