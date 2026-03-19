import type { AssertionResult } from "./AssertionResult";

export type ExecutionAssertionSummary = {
  executionId: string;
  total: number;
  passed: number;
  failed: number;
  results: AssertionResult[];
};
