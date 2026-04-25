import {
  ArrowUpDown, Activity,
  CheckCircle2, PauseCircle, XCircle, AlertCircle,
} from 'lucide-react';
import type { DeployStatus, SortKey, SortDir } from './deploymentTypes';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';

// ---------------------------------------------------------------------------
// Status icon
// ---------------------------------------------------------------------------

export function statusIcon(s: DeployStatus) {
  switch (s) {
    case 'active': return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />;
    case 'paused': return <PauseCircle className="w-3.5 h-3.5 text-amber-400" />;
    case 'failed': return <XCircle className="w-3.5 h-3.5 text-red-400" />;
    default: return <AlertCircle className="w-3.5 h-3.5 text-foreground" />;
  }
}

// ---------------------------------------------------------------------------
// Summary card
// ---------------------------------------------------------------------------

export function SummaryCard({
  icon: Icon,
  label,
  value,
  color = 'text-foreground',
  connected,
}: {
  icon: typeof Activity;
  label: string;
  value: number;
  color?: string;
  connected?: boolean;
}) {
  return (
    <div className="px-3 py-2.5 rounded-modal bg-secondary/30 border border-primary/10 flex items-center gap-2.5">
      <div className="w-8 h-8 rounded-card bg-secondary/50 border border-primary/15 flex items-center justify-center flex-shrink-0">
        <Icon className={`w-4 h-4 ${color}`} />
      </div>
      <div className="min-w-0">
        <div className={`typo-data-lg ${color}`}>{value}</div>
        <div className="typo-caption text-foreground flex items-center gap-1">
          {label}
          {connected !== undefined && (
            <span className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-emerald-400' : 'bg-muted-foreground/30'}`} />
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sort header
// ---------------------------------------------------------------------------

export function SortHeader({
  label,
  sortKey: key,
  current,
  dir,
  onToggle,
  align,
}: {
  label: string;
  sortKey: SortKey;
  current: SortKey;
  dir: SortDir;
  onToggle: (key: SortKey) => void;
  align?: 'right';
}) {
  const isActive = current === key;
  return (
    <th
      className={`px-4 py-2.5 typo-label text-foreground cursor-pointer hover:text-muted-foreground/90 transition-colors select-none ${
        align === 'right' ? 'text-right' : 'text-left'
      }`}
      onClick={() => onToggle(key)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        <ArrowUpDown className={`w-3 h-3 transition-colors ${isActive ? 'text-primary' : 'text-foreground'}`} />
        {isActive && (
          <span className="typo-caption text-primary">{dir === 'asc' ? '\u2191' : '\u2193'}</span>
        )}
      </span>
    </th>
  );
}

// ---------------------------------------------------------------------------
// Action button
// ---------------------------------------------------------------------------

export function ActionButton({
  title,
  icon: Icon,
  hoverColor,
  busy,
  onClick,
}: {
  title: string;
  icon: typeof Activity;
  hoverColor: string;
  busy: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={busy}
      className={`p-1.5 rounded-card text-foreground ${hoverColor} disabled:opacity-40 transition-colors cursor-pointer`}
    >
      {busy ? <LoadingSpinner size="sm" /> : <Icon className="w-3.5 h-3.5" />}
    </button>
  );
}
