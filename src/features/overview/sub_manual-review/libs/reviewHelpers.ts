import type { ManualReviewStatus } from '@/lib/bindings/ManualReviewStatus';

export const STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
};

export const SEVERITY_LABELS: Record<string, string> = {
  info: 'Info',
  warning: 'Warning',
  critical: 'Critical',
};

export type FilterStatus = 'all' | ManualReviewStatus;
export type SourceFilter = 'all' | 'local' | 'cloud';

export const FILTER_LABELS: Record<FilterStatus, string> = {
  all: 'All',
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
  resolved: 'Resolved',
};

export const SOURCE_LABELS: Record<SourceFilter, string> = {
  all: 'All Sources',
  local: 'Local',
  cloud: 'Cloud',
};

export function parseSuggestedActions(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map(String);
  } catch {
    // not JSON -- split by newlines or semicolons
  }
  return raw.split(/[;\n]+/).map((s) => s.trim()).filter(Boolean);
}
