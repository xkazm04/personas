import { Loader2, CheckCircle2, XCircle, RefreshCw, Download } from 'lucide-react';
import type { InstallState } from '@/hooks/utility/data/useAutoInstaller';

export function InstallButton({
  checkId,
  status,
  installState,
  onInstall,
}: {
  checkId: 'node' | 'claude_cli';
  status: string;
  installState: InstallState;
  onInstall: () => void;
}) {
  if (status === 'ok') return null;

  const label = checkId === 'node' ? 'Install Node.js' : 'Install Claude CLI';

  if (installState.phase === 'downloading' || installState.phase === 'installing') {
    return (
      <div className="mt-2 space-y-1.5">
        <div className="flex items-center gap-2">
          <Loader2 className="w-3 h-3 animate-spin text-violet-400" />
          <span className="text-sm text-violet-300">
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
          <p className="text-sm text-muted-foreground/80 truncate">
            {installState.outputLines[installState.outputLines.length - 1]}
          </p>
        )}
      </div>
    );
  }

  if (installState.phase === 'completed') {
    return (
      <div className="mt-2 flex items-center gap-1.5 text-sm text-emerald-400">
        <CheckCircle2 className="w-3 h-3" />
        Installed successfully
      </div>
    );
  }

  if (installState.phase === 'failed') {
    return (
      <div className="mt-2 space-y-1.5">
        <div className="flex items-center gap-1.5 text-sm text-red-400">
          <XCircle className="w-3 h-3" />
          {installState.error || 'Installation failed'}
        </div>
        {installState.manualCommand && (
          <div className="bg-primary/5 rounded-lg px-2 py-1.5">
            <p className="text-sm text-muted-foreground/80 mb-1">Try running manually:</p>
            <code className="text-sm text-foreground/80 font-mono select-all">
              {installState.manualCommand}
            </code>
          </div>
        )}
        <button
          onClick={onInstall}
          className="inline-flex items-center gap-1.5 px-2 py-1 text-sm font-medium rounded-lg border border-primary/20 text-foreground/90 hover:bg-secondary/60 transition-colors"
        >
          Retry
          <RefreshCw className="w-3 h-3" />
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={onInstall}
      className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 text-sm font-medium rounded-xl bg-violet-500/10 text-violet-300 border border-violet-500/20 hover:bg-violet-500/20 transition-colors"
    >
      <Download className="w-3 h-3" />
      {label}
    </button>
  );
}
