import { ShieldCheck, ShieldAlert, ShieldOff } from 'lucide-react';
import type { EnclaveVerifyResult } from '@/api/network/enclave';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { useTranslation } from '@/i18n/useTranslation';

export function EnclaveVerificationView({ result }: { result: EnclaveVerifyResult }) {
  const { t, tx } = useTranslation();
  const st = t.sharing;
  const allValid = result.signatureValid && result.contentIntact;

  return (
    <div className="space-y-3">
      {/* Status header */}
      <div className={`rounded-card border p-3 space-y-2 ${
        !allValid
          ? 'border-status-error/30 bg-status-error/5'
          : 'border-role-agent/20 bg-role-agent/5'
      }`}>
        <div className="flex items-center gap-2">
          {allValid ? (
            result.creatorTrusted ? (
              <ShieldCheck className="w-5 h-5 text-status-success" />
            ) : (
              <ShieldAlert className="w-5 h-5 text-status-warning" />
            )
          ) : (
            <ShieldOff className="w-5 h-5 text-status-error" />
          )}
          <div>
            <div className="typo-body text-foreground">
              {result.personaName}
            </div>
            <div className="typo-caption text-foreground">
              {tx(st.by_creator, { name: result.creatorDisplayName })}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 typo-caption">
          <span className={`px-1.5 py-0.5 rounded-full ${
            result.signatureValid
              ? 'bg-status-success/10 text-status-success'
              : 'bg-status-error/10 text-status-error'
          }`}>
            {result.signatureValid ? st.signature_valid : st.invalid_signature}
          </span>
          <span className={`px-1.5 py-0.5 rounded-full ${
            result.contentIntact
              ? 'bg-status-success/10 text-status-success'
              : 'bg-status-error/10 text-status-error'
          }`}>
            {result.contentIntact ? st.content_intact : st.content_tampered}
          </span>
          <span className={`px-1.5 py-0.5 rounded-full ${
            result.creatorTrusted
              ? 'bg-status-success/10 text-status-success'
              : 'bg-status-warning/10 text-status-warning'
          }`}>
            {result.creatorTrusted ? st.trusted_creator : st.unknown_creator}
          </span>
        </div>
      </div>

      {/* Creator identity */}
      <div className="rounded-card border border-border bg-secondary/10 p-3 space-y-1.5">
        <div className="typo-caption text-foreground">{st.creator_identity}</div>
        <div className="typo-caption text-foreground font-mono">
          {result.creatorPeerId.slice(0, 12)}...{result.creatorPeerId.slice(-12)}
        </div>
      </div>

      {/* Policy details */}
      <div className="rounded-card border border-border bg-secondary/10 p-3 space-y-2">
        <div className="typo-caption text-foreground">{st.execution_policy}</div>
        <div className="grid grid-cols-2 gap-2 typo-caption">
          <div>
            <span className="text-foreground">{st.max_cost_label}</span>{' '}
            <Numeric className="text-foreground" value={result.policy.maxCostUsd} unit="usd" />
          </div>
          <div>
            <span className="text-foreground">{st.max_turns_label}</span>{' '}
            <span className="text-foreground">{result.policy.maxTurns}</span>
          </div>
          <div>
            <span className="text-foreground">{st.persistence_label}</span>{' '}
            <span className="text-foreground">{result.policy.allowPersistence ? st.persistence_allowed : st.persistence_denied}</span>
          </div>
          <div>
            <span className="text-foreground">{st.capabilities_label}</span>{' '}
            <span className="text-foreground">
              {result.policy.requiredCapabilities.length || st.capabilities_none}
            </span>
          </div>
        </div>
      </div>

      {/* Enclave hash */}
      <div className="typo-caption text-foreground font-mono truncate">
        {st.enclave_hash_label} {result.enclaveHash}
      </div>
    </div>
  );
}
