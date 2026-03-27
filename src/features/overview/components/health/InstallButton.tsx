import { CheckCircle2, XCircle, RefreshCw, Download, ExternalLink } from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import type { InstallState } from '@/hooks/utility/data/useAutoInstaller';
import type { HealthCheckStatus } from '@/lib/bindings/HealthCheckStatus';
import { Button } from '@/features/shared/components/buttons';

const CLAUDE_DOWNLOAD_URL = 'https://docs.anthropic.com/en/docs/claude-code/overview';

export function InstallButton({
  checkId,
  status,
  installState,
  onInstall,
}: {
  checkId: 'node' | 'claude_cli';
  status: HealthCheckStatus;
  installState: InstallState;
  onInstall: () => void;
}) {
  if (status === 'ok') return null;

  const label = checkId === 'node' ? 'Install Node.js' : 'Install Claude CLI';

  if (installState.phase === 'downloading' || installState.phase === 'installing') {
    return (
      <div className="mt-2 space-y-1.5">
        <div className="flex items-center gap-2">
          <LoadingSpinner size="xs" className="text-violet-400" />
          <span className="typo-body text-violet-300">
            {installState.phase === 'downloading' ? 'Downloading...' : 'Installing...'}
          </span>
        </div>
        <div className="w-full h-1 bg-primary/10 rounded-full overflow-hidden">
          <div
            className="h-full bg-violet-500 rounded-full transition-all duration-300"
            style={{ width: `${installState.progressPct}%` }}
          />
        </div>
        {installState.outputLines.length > 0 && (
          <p className="typo-body text-muted-foreground/80 truncate">
            {installState.outputLines[installState.outputLines.length - 1]}
          </p>
        )}
      </div>
    );
  }

  if (installState.phase === 'completed') {
    return (
      <div className="mt-2 flex items-center gap-1.5 typo-body text-emerald-400">
        <CheckCircle2 className="w-3 h-3" />
        Installed successfully
      </div>
    );
  }

  if (installState.phase === 'failed') {
    return (
      <div className="mt-2 space-y-1.5">
        <div className="flex items-center gap-1.5 typo-body text-red-400">
          <XCircle className="w-3 h-3" />
          {installState.error || 'Installation failed'}
        </div>
        {installState.manualCommand && (
          <div className="bg-primary/5 rounded-lg px-2 py-1.5">
            <p className="typo-body text-muted-foreground/80 mb-1">Try running manually:</p>
            <code className="typo-code text-foreground/80 select-all">
              {installState.manualCommand}
            </code>
          </div>
        )}
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="secondary"
            size="xs"
            onClick={onInstall}
            iconRight={<RefreshCw className="w-3 h-3" />}
          >
            Retry
          </Button>
          {checkId === 'claude_cli' && (
            <a
              href={CLAUDE_DOWNLOAD_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-2 py-1 typo-heading rounded-lg border border-violet-500/20 text-violet-300 hover:bg-violet-500/10 transition-colors"
            >
              Official page
              <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="mt-2 flex items-center gap-2 flex-wrap">
      <Button
        variant="accent"
        accentColor="violet"
        size="xs"
        onClick={onInstall}
        icon={<Download className="w-3 h-3" />}
      >
        {label}
      </Button>
      {checkId === 'claude_cli' && (
        <Button
          variant="ghost"
          size="xs"
          className="border border-muted-foreground/20 text-muted-foreground hover:text-foreground"
          icon={<ExternalLink className="w-3 h-3" />}
          onClick={() => window.open(CLAUDE_DOWNLOAD_URL, '_blank', 'noopener,noreferrer')}
        >
          Official page
        </Button>
      )}
    </div>
  );
}
