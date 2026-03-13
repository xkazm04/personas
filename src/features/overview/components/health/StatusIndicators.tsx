import { CheckCircle2, AlertTriangle, XCircle, Info } from 'lucide-react';
import { SIMPLE_MODE } from '@/lib/utils/designTokens';
import type { HealthCheckItem } from "@/api/system/system";

export function getStatusIcon(status: string) {
  if (status === 'ok') return <CheckCircle2 className="w-4 h-4 text-status-success" />;
  if (status === 'warn') return <AlertTriangle className="w-4 h-4 text-status-warning" />;
  if (status === 'info' || status === 'inactive') return <Info className="w-4 h-4 text-status-neutral" />;
  return <XCircle className="w-4 h-4 text-status-error" />;
}

export function SectionStatusDot({ items }: { items: HealthCheckItem[] }) {
  const hasError = items.some((i) => i.status === 'error');
  const hasWarn = items.some((i) => i.status === 'warn');
  const allInactive = items.every((i) => i.status === 'inactive' || i.status === 'info');

  let dotColor = 'bg-status-success';
  if (hasError) dotColor = 'bg-status-error';
  else if (hasWarn) dotColor = 'bg-status-warning';
  else if (allInactive) dotColor = 'bg-status-neutral';

  return (
    <span className={`w-2 h-2 rounded-full ${dotColor}`} />
  );
}

/** Simple mode: displays a labeled dot badge instead of detailed status icons. */
export function SimpleStatusBadge({ items }: { items: HealthCheckItem[] }) {
  const hasError = items.some((i) => i.status === 'error');
  const hasWarn = items.some((i) => i.status === 'warn');

  const level = hasError ? 'problem' : hasWarn ? 'warning' : 'good';
  const token = SIMPLE_MODE.STATUS[level];

  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${token.bg} ${token.color}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${token.dot}`} />
      {token.label}
    </span>
  );
}
