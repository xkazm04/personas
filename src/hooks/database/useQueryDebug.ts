import { useCallback, useRef, useState } from 'react';
import { useCorrelatedCliStream } from '@/hooks/execution/useCorrelatedCliStream';
import { startQueryDebug, cancelQueryDebug } from '@/api/vault/database/dbSchema';
import type { QueryResult } from '@/api/vault/database/dbSchema';

export function useQueryDebug() {
  const [result, setResult] = useState<QueryResult | null>(null);
  const [correctedQuery, setCorrectedQuery] = useState<string | null>(null);
  const debugIdRef = useRef<string | null>(null);
  const serviceTypeRef = useRef<string>('');

  const stream = useCorrelatedCliStream({
    outputEvent: 'query-debug-output',
    statusEvent: 'query-debug-status',
    idField: 'job_id',
    onStatusEvent: (payload) => {
      if (payload['status'] === 'completed') {
        // Extract result from the custom status event
        const res = payload['result'];
        if (res && typeof res === 'object') {
          setResult(res as QueryResult);
        }
        const cq = payload['corrected_query'];
        if (typeof cq === 'string') {
          setCorrectedQuery(cq);
        }
      }
    },
  });

  const start = useCallback(
    async (credentialId: string, queryText: string, errorContext: string | null, serviceType: string) => {
      const debugId = crypto.randomUUID();
      debugIdRef.current = debugId;
      serviceTypeRef.current = serviceType;
      setResult(null);
      setCorrectedQuery(null);

      // Set up listeners before invoking backend
      await stream.start(debugId);
      await startQueryDebug(credentialId, queryText, errorContext, serviceType, debugId);
    },
    [stream.start],
  );

  const cancel = useCallback(async () => {
    if (debugIdRef.current) {
      await cancelQueryDebug(debugIdRef.current);
    }
  }, []);

  const clear = useCallback(async () => {
    await stream.reset();
    setResult(null);
    setCorrectedQuery(null);
    debugIdRef.current = null;
  }, [stream.reset]);

  return {
    start,
    cancel,
    clear,
    lines: stream.lines,
    lastLine: stream.lines[stream.lines.length - 1] ?? '',
    isRunning: stream.phase === 'running',
    phase: stream.phase,
    result,
    correctedQuery,
  };
}
