import { Zap, CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import { useCredentialHealth } from '@/features/vault/shared/hooks/health/useCredentialHealth';

/** Inline test-connection widget reused in empty/unsupported states. */
export function TestConnectionButton({ credentialId }: { credentialId: string }) {
  const { result, isHealthchecking, checkStored } = useCredentialHealth(credentialId);

  return (
    <div className="flex flex-col items-center gap-3">
      <button
        onClick={checkStored}
        disabled={isHealthchecking}
        className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium bg-primary/10 text-primary hover:bg-primary/15 disabled:opacity-50 transition-colors"
      >
        {isHealthchecking ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : (
          <Zap className="w-3.5 h-3.5" />
        )}
        {isHealthchecking ? 'Testing...' : 'Test Connection'}
      </button>

      {result && !isHealthchecking && (
        <div
          className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm ${
            result.success
              ? 'bg-emerald-500/10 text-emerald-400'
              : 'bg-red-500/10 text-red-400'
          }`}
        >
          {result.success ? (
            <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
          ) : (
            <XCircle className="w-3.5 h-3.5 shrink-0" />
          )}
          <span className="truncate max-w-xs">{result.message}</span>
        </div>
      )}
    </div>
  );
}
