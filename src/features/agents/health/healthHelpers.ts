import type { DryRunResult } from './types';
import { inferIssueSeverity } from '@/lib/errorTaxonomy';

/** Shared monotonic counter for health-issue IDs across all health-check consumers. */
let issueSeq = 1;

export function nextIssueSeq(): number {
  return issueSeq++;
}

/** @see {@link inferIssueSeverity} — re-exported alias for health-check consumers */
export const inferSeverity = inferIssueSeverity;

/** Map a feasibility "overall" string to a DryRunResult status. */
export function mapOverallStatus(overall: string): DryRunResult['status'] {
  const o = overall.toLowerCase();
  if (o.includes('ready') || o.includes('pass') || o.includes('success')) return 'ready';
  if (o.includes('block') || o.includes('fail')) return 'blocked';
  return 'partial';
}
