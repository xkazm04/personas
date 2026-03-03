export interface ConnectorStatus {
  name: string;
  credentialId: string | null;
  credentialName: string | null;
  testing: boolean;
  result: { success: boolean; message: string } | null;
}

export const STATUS_CONFIG = {
  ready: { color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/20', label: 'Ready' },
  untested: { color: 'text-blue-400', bg: 'bg-blue-500/10 border-blue-500/20', label: 'Untested' },
  failed: { color: 'text-red-400', bg: 'bg-red-500/10 border-red-500/20', label: 'Failed' },
  missing: { color: 'text-amber-400', bg: 'bg-amber-500/10 border-amber-500/20', label: 'No credential' },
  testing: { color: 'text-blue-400', bg: 'bg-blue-500/10 border-blue-500/20', label: 'Testing...' },
} as const;

export function getStatusKey(status: ConnectorStatus): keyof typeof STATUS_CONFIG {
  if (status.testing) return 'testing';
  if (!status.credentialId) return 'missing';
  if (!status.result) return 'untested';
  return status.result.success ? 'ready' : 'failed';
}
