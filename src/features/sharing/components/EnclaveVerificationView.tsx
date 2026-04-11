import { ShieldCheck, ShieldAlert, ShieldOff } from 'lucide-react';
import type { EnclaveVerifyResult } from '@/api/network/enclave';
import { useTranslation } from '@/i18n/useTranslation';

export function EnclaveVerificationView({ result }: { result: EnclaveVerifyResult }) {
  const { t } = useTranslation();
  const st = t.sharing;
  const allValid = result.signatureValid && result.contentIntact;

  return (
    <div className="space-y-3">
      {/* Status header */}
      <div className={`rounded-lg border p-3 space-y-2 ${
        !allValid
          ? 'border-red-500/30 bg-red-500/5'
          : 'border-violet-500/20 bg-violet-500/5'
      }`}>
        <div className="flex items-center gap-2">
          {allValid ? (
            result.creatorTrusted ? (
              <ShieldCheck className="w-5 h-5 text-emerald-400" />
            ) : (
              <ShieldAlert className="w-5 h-5 text-amber-400" />
            )
          ) : (
            <ShieldOff className="w-5 h-5 text-red-400" />
          )}
          <div>
            <div className="text-sm font-medium text-foreground">
              {result.personaName}
            </div>
            <div className="text-[10px] text-muted-foreground">
              by {result.creatorDisplayName}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-[10px]">
          <span className={`px-1.5 py-0.5 rounded-full ${
            result.signatureValid
              ? 'bg-emerald-500/10 text-emerald-400'
              : 'bg-red-500/10 text-red-400'
          }`}>
            {result.signatureValid ? st.signature_valid : st.invalid_signature}
          </span>
          <span className={`px-1.5 py-0.5 rounded-full ${
            result.contentIntact
              ? 'bg-emerald-500/10 text-emerald-400'
              : 'bg-red-500/10 text-red-400'
          }`}>
            {result.contentIntact ? st.content_intact : st.content_tampered}
          </span>
          <span className={`px-1.5 py-0.5 rounded-full ${
            result.creatorTrusted
              ? 'bg-emerald-500/10 text-emerald-400'
              : 'bg-amber-500/10 text-amber-400'
          }`}>
            {result.creatorTrusted ? st.trusted_creator : st.unknown_creator}
          </span>
        </div>
      </div>

      {/* Creator identity */}
      <div className="rounded-lg border border-border bg-secondary/10 p-3 space-y-1.5">
        <div className="text-xs text-muted-foreground font-medium">{st.creator_identity}</div>
        <div className="text-[10px] text-muted-foreground font-mono">
          {result.creatorPeerId.slice(0, 12)}...{result.creatorPeerId.slice(-12)}
        </div>
      </div>

      {/* Policy details */}
      <div className="rounded-lg border border-border bg-secondary/10 p-3 space-y-2">
        <div className="text-xs text-muted-foreground font-medium">{st.execution_policy}</div>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div>
            <span className="text-muted-foreground">{st.max_cost_label}</span>{' '}
            <span className="text-foreground">${result.policy.maxCostUsd.toFixed(2)}</span>
          </div>
          <div>
            <span className="text-muted-foreground">{st.max_turns_label}</span>{' '}
            <span className="text-foreground">{result.policy.maxTurns}</span>
          </div>
          <div>
            <span className="text-muted-foreground">{st.persistence_label}</span>{' '}
            <span className="text-foreground">{result.policy.allowPersistence ? st.persistence_allowed : st.persistence_denied}</span>
          </div>
          <div>
            <span className="text-muted-foreground">{st.capabilities_label}</span>{' '}
            <span className="text-foreground">
              {result.policy.requiredCapabilities.length || st.capabilities_none}
            </span>
          </div>
        </div>
      </div>

      {/* Enclave hash */}
      <div className="text-[10px] text-muted-foreground/60 font-mono truncate">
        Hash: {result.enclaveHash}
      </div>
    </div>
  );
}
