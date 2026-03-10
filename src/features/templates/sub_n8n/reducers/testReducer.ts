import type { CliRunPhase } from '@/hooks/execution/useCorrelatedCliStream';
import type { N8nImportAction } from '../hooks/useN8nImportReducer';

// ── Test State Slice ──

export interface TestState {
  testStatus: 'idle' | 'running' | 'passed' | 'failed';
  testError: string | null;
  testRunId: string | null;
  testLines: string[];
  testPhase: CliRunPhase;
}

export const INITIAL_TEST: TestState = {
  testStatus: 'idle',
  testError: null,
  testRunId: null,
  testLines: [],
  testPhase: 'idle',
};

// ── Reducer ──

export function testReducer(
  slice: TestState,
  action: N8nImportAction,
): TestState {
  switch (action.type) {
    case 'TEST_STREAM_STARTED':
      return { ...slice, testRunId: action.testId, testStatus: 'running', testError: null, testLines: [], testPhase: 'running' };

    case 'TEST_LINES':
      return { ...slice, testLines: action.lines };

    case 'TEST_PHASE':
      return { ...slice, testPhase: action.phase };

    case 'TEST_STARTED':
      return { ...slice, testStatus: 'running', testError: null };

    case 'TEST_PASSED':
      return { ...slice, testStatus: 'passed', testError: null, testPhase: 'completed' };

    case 'TEST_FAILED':
      return { ...slice, testStatus: 'failed', testError: action.error, testPhase: 'failed' };

    // Draft changes invalidate test results
    case 'DRAFT_UPDATED':
    case 'DRAFT_JSON_EDITED':
      return INITIAL_TEST;

    case 'FILE_PARSED':
      return INITIAL_TEST;

    default:
      return slice;
  }
}
