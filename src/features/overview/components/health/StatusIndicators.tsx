import { CheckCircle2, AlertTriangle, XCircle, Info } from 'lucide-react';
import type { HealthCheckItem } from '@/api/tauriApi';

export function getStatusIcon(status: string) {
  if (status === 'ok') return <CheckCircle2 className="w-4 h-4 text-emerald-400" />;
  if (status === 'warn') return <AlertTriangle className="w-4 h-4 text-amber-400" />;
  if (status === 'info' || status === 'inactive') return <Info className="w-4 h-4 text-muted-foreground" />;
  return <XCircle className="w-4 h-4 text-red-400" />;
}

export function SectionStatusDot({ items }: { items: HealthCheckItem[] }) {
  const hasError = items.some((i) => i.status === 'error');
  const hasWarn = items.some((i) => i.status === 'warn');
  const allInactive = items.every((i) => i.status === 'inactive' || i.status === 'info');

  let dotColor = 'bg-emerald-400';
  if (hasError) dotColor = 'bg-red-400';
  else if (hasWarn) dotColor = 'bg-amber-400';
  else if (allInactive) dotColor = 'bg-zinc-500';

  return (
    <span className={`w-2 h-2 rounded-full ${dotColor}`} />
  );
}
