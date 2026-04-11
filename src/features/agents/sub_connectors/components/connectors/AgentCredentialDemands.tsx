import { useState, useCallback } from 'react';
import { Key, Plug, ArrowRight, CheckCircle2, AlertTriangle, Sparkles } from 'lucide-react';
import { useAgentStore } from "@/stores/agentStore";
import { useVaultStore } from "@/stores/vaultStore";
import { CredentialDesignModal } from '@/features/vault/sub_catalog/components/design/CredentialDesignModal';
import { mutateCredentialLink } from '@/hooks/design/core/useDesignContextMutator';
import { toastCatch } from "@/lib/silentCatch";
import { useUnfulfilledCredentials, type UnfulfilledCredential } from '../../libs/useUnfulfilledCredentials';

export function AgentCredentialDemands() {
  const selectedPersona = useAgentStore((s) => s.selectedPersona);
  const fetchCredentials = useVaultStore((s) => s.fetchCredentials);
  const { totalDemands, fulfilledCount, unfulfilledCount, reusableCount, demands } = useUnfulfilledCredentials();

  const [designOpen, setDesignOpen] = useState(false);
  const [designInstruction, setDesignInstruction] = useState('');
  const [linkingDemand, setLinkingDemand] = useState<string | null>(null);

  const handleProvision = useCallback((demand: UnfulfilledCredential) => {
    setDesignInstruction(`${demand.connectorLabel} API credential`);
    setDesignOpen(true);
  }, []);

  const handleReuse = useCallback(async (demand: UnfulfilledCredential, credentialId: string) => {
    if (!selectedPersona) return;
    try {
      await mutateCredentialLink(selectedPersona.id, demand.connectorName, credentialId);
      await fetchCredentials();
    } catch {
      // intentional: non-critical -- link will retry on next attempt
    }
    setLinkingDemand(null);
  }, [selectedPersona, fetchCredentials]);

  const handleDesignComplete = useCallback(() => {
    setDesignOpen(false);
    setDesignInstruction('');
    void fetchCredentials().catch(toastCatch("AgentCredentialDemands:fetchCredentialsOnDesignComplete", "Failed to refresh credentials after setup"));
  }, [fetchCredentials]);

  if (totalDemands === 0 || unfulfilledCount === 0) return null;

  return (
    <div className="space-y-3">
      {/* Summary banner */}
      <div className="flex items-start gap-2.5 p-3 rounded-xl bg-violet-500/5 border border-violet-500/15">
        <Key className="w-4 h-4 text-violet-400/70 flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-violet-400/80">
            {unfulfilledCount} credential{unfulfilledCount !== 1 ? 's' : ''} needed
          </p>
          <p className="text-xs text-violet-400/50 mt-0.5">
            {fulfilledCount}/{totalDemands} connector{totalDemands !== 1 ? 's' : ''} fulfilled
            {reusableCount > 0 && (
              <span> &middot; {reusableCount} can reuse existing credentials</span>
            )}
          </p>
        </div>
      </div>

      {/* Demand cards */}
      <div className="space-y-2">
        {demands.map((demand) => (
          <DemandCard
            key={demand.connectorName}
            demand={demand}
            isLinking={linkingDemand === demand.connectorName}
            onProvision={() => handleProvision(demand)}
            onToggleLinking={() => setLinkingDemand((p) => p === demand.connectorName ? null : demand.connectorName)}
            onReuse={(credId) => void handleReuse(demand, credId)}
          />
        ))}
      </div>

      {/* Design modal */}
      {designOpen && (
        <div className="mt-3 border border-violet-500/20 rounded-xl overflow-hidden">
          <CredentialDesignModal
            open={designOpen}
            embedded
            initialInstruction={designInstruction}
            onClose={() => { setDesignOpen(false); setDesignInstruction(''); }}
            onComplete={handleDesignComplete}
          />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Demand card
// ---------------------------------------------------------------------------

function DemandCard({
  demand,
  isLinking,
  onProvision,
  onToggleLinking,
  onReuse,
}: {
  demand: UnfulfilledCredential;
  isLinking: boolean;
  onProvision: () => void;
  onToggleLinking: () => void;
  onReuse: (credentialId: string) => void;
}) {
  const hasReusable = demand.matchingCredentials.length > 0;

  return (
    <div className="rounded-xl border border-primary/10 bg-secondary/20 overflow-hidden">
      <div className="flex items-center gap-2.5 px-3 py-2.5">
        {/* Connector icon */}
        <div
          className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ background: `${demand.connectorColor}15`, border: `1px solid ${demand.connectorColor}30` }}
        >
          <Plug className="w-3.5 h-3.5" style={{ color: demand.connectorColor }} />
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-medium text-foreground/85">{demand.connectorLabel}</span>
            <AlertTriangle className="w-3 h-3 text-amber-400/60" />
          </div>
          <p className="text-xs text-muted-foreground/50 truncate">
            Required by tools &middot; no credential linked
          </p>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {hasReusable && (
            <button
              type="button"
              onClick={onToggleLinking}
              className={`flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors cursor-pointer ${
                isLinking
                  ? 'bg-blue-500/15 text-blue-400 border-blue-500/25'
                  : 'border-primary/20 text-muted-foreground/70 hover:bg-secondary/50 hover:text-foreground/80'
              }`}
            >
              <ArrowRight className="w-3 h-3" />
              Reuse ({demand.matchingCredentials.length})
            </button>
          )}
          <button
            type="button"
            onClick={onProvision}
            className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-violet-500/20 bg-violet-500/10 text-violet-400 hover:bg-violet-500/20 transition-colors cursor-pointer"
          >
            <Sparkles className="w-3 h-3" />
            Create
          </button>
        </div>
      </div>

      {/* Reusable credentials dropdown */}
      {isLinking && hasReusable && (
          <div
            className="animate-fade-slide-in overflow-hidden"
          >
            <div className="px-3 pb-2.5 pt-1 border-t border-primary/10 space-y-1">
              <p className="text-xs text-muted-foreground/50 mb-1.5">
                Link an existing credential:
              </p>
              {demand.matchingCredentials.map((cred) => (
                <button
                  key={cred.id}
                  type="button"
                  onClick={() => onReuse(cred.id)}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-secondary/40 transition-colors text-left cursor-pointer"
                >
                  <Key className="w-3 h-3 text-emerald-400/60" />
                  <span className="text-xs text-foreground/80 flex-1 truncate">{cred.name}</span>
                  {cred.healthcheck_last_success === true && (
                    <CheckCircle2 className="w-3 h-3 text-emerald-400/60" />
                  )}
                  {cred.healthcheck_last_success === false && (
                    <AlertTriangle className="w-3 h-3 text-red-400/60" />
                  )}
                </button>
              ))}
            </div>
          </div>
        )}
    </div>
  );
}
