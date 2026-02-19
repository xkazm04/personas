import { Shield, ShieldAlert } from 'lucide-react';
import type { VaultStatus } from '@/api/tauriApi';

interface VaultStatusBadgeProps {
  vault: VaultStatus;
}

export function VaultStatusBadge({ vault }: VaultStatusBadgeProps) {
  if (vault.total <= 0) return null;

  const className = `flex items-center gap-1.5 text-[11px] px-2 py-0.5 rounded-md border ${
    vault.plaintext > 0
      ? 'bg-amber-500/10 border-amber-500/20 text-amber-400'
      : vault.key_source === 'keychain'
        ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
        : 'bg-yellow-500/10 border-yellow-500/20 text-yellow-400'
  }`;

  return (
    <span className={className}>
      {vault.plaintext > 0 ? (
        <><ShieldAlert className="w-3 h-3" />{vault.plaintext} unencrypted</>
      ) : vault.key_source === 'keychain' ? (
        <><Shield className="w-3 h-3" />Encrypted</>
      ) : (
        <><Shield className="w-3 h-3" />Encrypted (fallback key)</>
      )}
    </span>
  );
}
