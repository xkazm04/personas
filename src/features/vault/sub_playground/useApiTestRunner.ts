import { useState, useRef, useCallback } from 'react';
import { executeApiRequest, type ApiEndpoint, type ApiProxyResponse } from '@/api/apiProxy';

// ── Types ─────────────────────────────────────────────────────────────

export type TestVerdict = 'pending' | 'running' | 'passed' | 'failed' | 'skipped';

export interface EndpointTestResult {
  key: string;               // "METHOD:PATH"
  verdict: TestVerdict;
  httpStatus?: number;
  statusText?: string;
  durationMs?: number;
  error?: string;
}

export interface TestProgress {
  current: number;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  startedAt: number;
}

export interface UseApiTestRunnerReturn {
  results: Map<string, EndpointTestResult>;
  isRunning: boolean;
  lastLog: string;
  lines: string[];
  progress: TestProgress | null;
  runAll: (endpoints: ApiEndpoint[], credentialId: string) => void;
  cancel: () => void;
  clear: () => void;
}

// ── Helpers ───────────────────────────────────────────────────────────

function endpointKey(ep: ApiEndpoint): string {
  return `${ep.method.toUpperCase()}:${ep.path}`;
}

/** True if endpoint has unresolvable path params like {id} with no default. */
function hasRequiredPathParams(ep: ApiEndpoint): boolean {
  return /{[^}]+}/.test(ep.path);
}

/** Classify HTTP status into a verdict. */
function verdictFromStatus(status: number): TestVerdict {
  if (status >= 200 && status < 300) return 'passed';
  if (status === 401 || status === 403) return 'failed';
  // 400, 404, 422 etc — server responded, auth worked, endpoint exists
  // Treat 4xx (non-auth) as passed (reachable) and 5xx as failed
  if (status >= 400 && status < 500) return 'passed';
  return 'failed'; // 5xx
}

function timestamp(): string {
  return new Date().toLocaleTimeString('en-US', { hour12: false });
}

// ── Concurrency runner ────────────────────────────────────────────────

async function runWithConcurrency<T>(
  tasks: (() => Promise<T>)[],
  concurrency: number,
  cancelled: { current: boolean },
): Promise<void> {
  let nextIndex = 0;

  const worker = async (): Promise<void> => {
    while (!cancelled.current) {
      const idx = nextIndex++;
      if (idx >= tasks.length) return;
      await tasks[idx]!();
    }
  };

  const workers = Array.from(
    { length: Math.min(concurrency, tasks.length) },
    () => worker(),
  );
  await Promise.all(workers);
}

// ── Default concurrency ───────────────────────────────────────────────
const CONCURRENCY = 5;

// ── Hook ──────────────────────────────────────────────────────────────

export function useApiTestRunner(): UseApiTestRunnerReturn {
  const [results, setResults] = useState<Map<string, EndpointTestResult>>(new Map());
  const [isRunning, setIsRunning] = useState(false);
  const [lastLog, setLastLog] = useState('');
  const [lines, setLines] = useState<string[]>([]);
  const [progress, setProgress] = useState<TestProgress | null>(null);
  const cancelledRef = useRef(false);

  const addLog = useCallback((line: string) => {
    const entry = `[${timestamp()}] ${line}`;
    setLines(prev => {
      const next = [...prev, entry];
      return next.length > 500 ? next.slice(-500) : next;
    });
    setLastLog(entry);
  }, []);

  const runAll = useCallback((endpoints: ApiEndpoint[], credentialId: string) => {
    if (isRunning) return;

    cancelledRef.current = false;
    setIsRunning(true);
    setLines([]);
    setLastLog('');

    // Build initial result map
    const initialResults = new Map<string, EndpointTestResult>();
    const testable: ApiEndpoint[] = [];
    let skippedCount = 0;

    for (const ep of endpoints) {
      const key = endpointKey(ep);
      if (hasRequiredPathParams(ep)) {
        initialResults.set(key, { key, verdict: 'skipped', error: 'Has path parameters' });
        skippedCount++;
      } else {
        initialResults.set(key, { key, verdict: 'pending' });
        testable.push(ep);
      }
    }

    setResults(initialResults);

    const total = testable.length;
    let current = 0;
    let passed = 0;
    let failed = 0;

    const startedAt = Date.now();
    setProgress({ current: 0, total, passed: 0, failed: 0, skipped: skippedCount, startedAt });

    addLog(`Starting batch test: ${total} endpoints (${skippedCount} skipped — path params)`);
    addLog(`Concurrency: ${CONCURRENCY} parallel requests`);

    const tasks = testable.map((ep) => async () => {
      if (cancelledRef.current) return;

      const key = endpointKey(ep);
      const method = ep.method.toUpperCase();

      // Mark running
      setResults(prev => {
        const next = new Map(prev);
        const existing = next.get(key);
        if (existing) next.set(key, { ...existing, verdict: 'running' });
        return next;
      });
      addLog(`→ ${method} ${ep.path}`);

      try {
        const res: ApiProxyResponse = await executeApiRequest(
          credentialId,
          method,
          ep.path,
          {},
          undefined,
        );

        const verdict = verdictFromStatus(res.status);
        if (verdict === 'passed') passed++; else failed++;
        current++;

        setResults(prev => {
          const next = new Map(prev);
          next.set(key, {
            key,
            verdict,
            httpStatus: res.status,
            statusText: res.status_text,
            durationMs: res.duration_ms,
          });
          return next;
        });

        const icon = verdict === 'passed' ? '✓' : '✗';
        addLog(`  ${icon} ${res.status} ${res.status_text} (${res.duration_ms}ms)`);
      } catch (err) {
        failed++;
        current++;

        const errorMsg = err instanceof Error ? err.message : String(err);
        setResults(prev => {
          const next = new Map(prev);
          next.set(key, { key, verdict: 'failed', error: errorMsg });
          return next;
        });

        addLog(`  ✗ ERROR: ${errorMsg}`);
      }

      setProgress({ current, total, passed, failed, skipped: skippedCount, startedAt });
    });

    // Run with concurrency then finalize
    runWithConcurrency(tasks, CONCURRENCY, cancelledRef).then(() => {
      const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);

      if (cancelledRef.current) {
        addLog(`Cancelled after ${current}/${total} endpoints (${elapsed}s)`);
      } else {
        addLog(`Done: ${passed} passed, ${failed} failed, ${skippedCount} skipped (${elapsed}s)`);
      }

      setIsRunning(false);
    });
  }, [isRunning, addLog]);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
  }, []);

  const clear = useCallback(() => {
    setResults(new Map());
    setLines([]);
    setLastLog('');
    setProgress(null);
  }, []);

  return { results, isRunning, lastLog, lines, progress, runAll, cancel, clear };
}
