import { Shield, Lock } from 'lucide-react';

interface AutoRollbackProToggleProps {
  enabled: boolean;
  loading: boolean;
  onToggle: () => void;
}

export function AutoRollbackProToggle({ enabled, loading, onToggle }: AutoRollbackProToggleProps) {
  return (
    <div className="rounded-lg border border-primary/8 bg-secondary/30 p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield className="w-3.5 h-3.5 text-violet-400/70" />
          <span className="text-sm text-muted-foreground/70">Auto-rollback</span>
          <span className="text-[10px] font-medium text-violet-400 bg-violet-500/10 px-1.5 py-0.5 rounded-full border border-violet-500/20 flex items-center gap-0.5">
            <Lock className="w-2.5 h-2.5" />
            Pro
          </span>
        </div>
        <button
          onClick={onToggle}
          disabled={loading}
          className={`relative w-8 h-[18px] rounded-full transition-colors ${
            enabled ? 'bg-violet-500/30' : 'bg-secondary/60'
          } disabled:opacity-50`}
          title="Auto-rollback when error rate exceeds 2x the previous version"
        >
          <div
            className={`absolute top-0.5 w-3.5 h-3.5 rounded-full transition-all ${
              enabled
                ? 'left-[calc(100%-18px)] bg-violet-400'
                : 'left-0.5 bg-muted-foreground/40'
            }`}
          />
        </button>
      </div>
      <p className="text-[11px] text-muted-foreground/60 mt-1.5">
        Automatically rollback if error rate exceeds 2x the previous version&apos;s rate.
      </p>
    </div>
  );
}
