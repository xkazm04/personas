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

/** Line classifier for API test output (checkmark/cross/arrow markers). */
export function apiTestLineClassName(line: string): string {
  if (line.includes('\u2713')) return 'text-emerald-400/70';
  if (line.includes('\u2717')) return 'text-red-400/70';
  if (line.includes('\u2192')) return 'text-blue-400/50';
  if (line.includes('Done:') || line.includes('Starting')) return 'text-foreground';
  return 'text-foreground';
}
