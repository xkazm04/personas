import type { ApiEndpoint } from '@/api/system/apiProxy';

/** Merge incoming endpoints into existing, deduplicating by METHOD:path key. */
export function mergeEndpoints(existing: ApiEndpoint[], incoming: ApiEndpoint[]): ApiEndpoint[] {
  const seen = new Set(existing.map((ep) => `${ep.method.toUpperCase()}:${ep.path}`));
  const merged = [...existing];
  for (const ep of incoming) {
    const key = `${ep.method.toUpperCase()}:${ep.path}`;
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(ep);
    }
  }
  return merged;
}

/**
 * The markers `useApiTestRunner` writes into its log. One table for writer and
 * reader: the classifier below used to look for the Unicode check, cross and
 * arrow while the runner wrote ASCII, so not one of the three ever matched and
 * every pass, failure and request line rendered in the same colour.
 */
export const RUN_LOG_MARK = { pass: '[v]', fail: '[x]', send: '->' } as const;

/** Line classifier for API test output (pass/fail/request markers). */
export function apiTestLineClassName(line: string): string {
  if (line.includes(RUN_LOG_MARK.pass)) return 'text-emerald-400/70';
  if (line.includes(RUN_LOG_MARK.fail)) return 'text-red-400/70';
  if (line.includes(`${RUN_LOG_MARK.send} `)) return 'text-blue-400/50';
  return 'text-foreground';
}
