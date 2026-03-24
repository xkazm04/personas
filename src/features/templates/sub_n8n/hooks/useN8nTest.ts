import { useEffect } from 'react';
import { useCorrelatedCliStream } from '@/hooks/execution/useCorrelatedCliStream';
import { EventName } from '@/lib/eventRegistry';
import type { N8nImportAction } from './useN8nImportReducer';

export interface N8nTestApi {
  startTestStream: (id: string) => Promise<void>;
  resetTestStream: () => Promise<void>;
}

/**
 * Manages the draft-test CLI stream for the n8n import wizard.
 *
 * Listens for test output/status events, syncs lines and phase into the
 * reducer, and auto-prefills an adjustment request on failure.
 */
export function useN8nTest(
  dispatch: React.Dispatch<N8nImportAction>,
): N8nTestApi {
  const {
    start: startTestStream,
    reset: resetTestStream,
    lines: testStreamLines,
    phase: testStreamPhase,
  } = useCorrelatedCliStream({
    outputEvent: EventName.N8N_TEST_OUTPUT,
    statusEvent: EventName.N8N_TEST_STATUS,
    idField: 'test_id',
    onFailed: (message) => {
      dispatch({ type: 'TEST_FAILED', error: message });
      if (message) {
        dispatch({
          type: 'SET_ADJUSTMENT',
          text: `Fix: The test execution failed with: ${message.slice(0, 200)}. Please adjust the persona to fix this issue.`,
        });
      }
    },
  });

  // Sync test stream lines into reducer
  useEffect(() => {
    dispatch({ type: 'TEST_LINES', lines: testStreamLines });
  }, [testStreamLines, dispatch]);

  // Sync test stream phase into reducer
  useEffect(() => {
    dispatch({ type: 'TEST_PHASE', phase: testStreamPhase });
    if (testStreamPhase === 'completed') {
      dispatch({ type: 'TEST_PASSED' });
    }
    if (testStreamPhase === 'failed') {
      const fallbackMessage = testStreamLines[testStreamLines.length - 1] || 'Test execution failed.';
      dispatch({ type: 'TEST_FAILED', error: fallbackMessage });
      dispatch({
        type: 'SET_ADJUSTMENT',
        text: `Fix: The test execution failed with: ${fallbackMessage.slice(0, 200)}. Please adjust the persona to fix this issue.`,
      });
    }
  }, [testStreamPhase, testStreamLines, dispatch]);

  return { startTestStream, resetTestStream };
}
