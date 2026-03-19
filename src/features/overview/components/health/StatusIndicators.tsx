import { CheckCircle2, AlertTriangle, XCircle, Info } from 'lucide-react';
import { SIMPLE_MODE } from '@/lib/utils/designTokens';
import { StatusShape } from '@/features/shared/components/display/StatusShape';
import type { StatusKey } from '@/lib/design/statusTokens';
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

  let status: StatusKey = 'success';
  if (hasError) status = 'error';
  else if (hasWarn) status = 'warning';
  else if (allInactive) status = 'neutral';

  return <StatusShape status={status} />;
}

/** Simple mode: displays a labeled dot badge instead of detailed status icons. */
export function SimpleStatusBadge({ items }: { items: HealthCheckItem[] }) {
  const hasError = items.some((i) => i.status === 'error');
  const hasWarn = items.some((i) => i.status === 'warn');

  const level = hasError ? 'problem' : hasWarn ? 'warning' : 'good';
  const token = SIMPLE_MODE.STATUS[level];

  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full typo-caption ${token.bg} ${token.color}`}>
      <StatusShape status={hasError ? 'error' : hasWarn ? 'warning' : 'success'} size="xs" colorClass="" />
      {token.label}
    </span>
  );
}
