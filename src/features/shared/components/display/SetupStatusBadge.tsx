import { AlertTriangle, Settings, CheckCircle2 } from 'lucide-react';

type Status = 'ready' | 'needs_credentials' | 'misconfigured';

interface Props {
  status: string | null | undefined;
  variant?: 'compact' | 'inline';
  className?: string;
}

export function SetupStatusBadge({ status, variant = 'compact', className = '' }: Props) {
  const key = (status ?? 'ready') as Status;

  // Don't render anything for the happy path — only surface when attention needed.
  if (key === 'ready') {
    if (variant === 'inline') {
      return (
        <span className={`inline-flex items-center gap-1 typo-caption text-emerald-400/80 ${className}`}>
          <CheckCircle2 className="w-3 h-3" /> Ready
        </span>
      );
    }
    return null;
  }

  if (key === 'needs_credentials') {
    return (
      <span
        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-card typo-caption font-medium bg-amber-500/10 text-amber-400 border border-amber-500/30 ${className}`}
        title="One or more declared connectors have no vault credential. Add credentials in Settings → Vault, then re-enable the persona."
      >
        <AlertTriangle className="w-3 h-3" />
        Setup required
      </span>
    );
  }

  // misconfigured (future expansion)
  return (
    <span
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-card typo-caption font-medium bg-red-500/10 text-red-400 border border-red-500/30 ${className}`}
      title="This persona has a configuration problem — see the persona detail for specifics."
    >
      <Settings className="w-3 h-3" />
      Misconfigured
    </span>
  );
}
