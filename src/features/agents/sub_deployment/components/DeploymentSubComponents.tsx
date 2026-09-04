import {
  Activity,
  CheckCircle2, PauseCircle, XCircle, AlertCircle, FileText,
} from 'lucide-react';
import type { DeployStatus, SortKey, SortDir } from './deploymentTypes';
import { AsyncButton } from '@/features/shared/components/buttons';
import { SortableHeader } from '@/features/shared/components/display/SortableHeader';
import { AnimatedCounter } from '@/features/shared/components/display/AnimatedCounter';

// ---------------------------------------------------------------------------
// Status icon
// ---------------------------------------------------------------------------

export function statusIcon(s: DeployStatus) {
  switch (s) {
    case 'active': return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />;
    case 'paused': return <PauseCircle className="w-3.5 h-3.5 text-amber-400" />;
    case 'failed': return <XCircle className="w-3.5 h-3.5 text-red-400" />;
    case 'file-based': return <FileText className="w-3.5 h-3.5 text-sky-400" />;
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
        {/* Count-up IS the reveal (docs/design/overview-loading.md) — never
            gate this behind a loading flag or ghost it; it animates from
            whatever the previous value was (0 on first mount) to the new
            one every time `value` changes, including the settle after fetch. */}
        <AnimatedCounter value={value} className={`typo-data-lg ${color}`} />
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
  return (
    <SortableHeader
      label={label}
      active={current === key}
      dir={dir}
      onSort={() => onToggle(key)}
      align={align === 'right' ? 'right' : 'left'}
    />
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
  // A busy action control shows a REAL spinner (AsyncButton owns it); the
  // old `busy ? <LoadingSpinner/> : <Icon/>` swap rendered nothing at all.
  return (
    <AsyncButton
      variant="ghost"
      size="icon-sm"
      title={title}
      onClick={onClick}
      isLoading={busy}
      icon={<Icon className="w-3.5 h-3.5" />}
      className={hoverColor.replace(/hover:(text|bg)-/g, 'hover:!$1-')}
    />
  );
}
