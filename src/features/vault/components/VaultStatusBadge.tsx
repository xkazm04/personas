import { useState, useCallback, useRef, useEffect } from 'react';
import { Shield, ShieldAlert, ShieldCheck, ChevronDown, Lock, KeyRound, HardDrive, Loader2 } from 'lucide-react';
import type { VaultStatus } from '@/api/tauriApi';
import { migratePlaintextCredentials, vaultStatus as refreshVaultStatus } from '@/api/tauriApi';

interface VaultStatusBadgeProps {
  vault: VaultStatus;
  onVaultRefresh?: (updated: VaultStatus) => void;
}

export function VaultStatusBadge({ vault, onVaultRefresh }: VaultStatusBadgeProps) {
  const [open, setOpen] = useState(false);
  const [isMigrating, setIsMigrating] = useState(false);
  const [migrationResult, setMigrationResult] = useState<{ migrated: number; failed: number } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleEncryptNow = useCallback(async () => {
    setIsMigrating(true);
    setMigrationResult(null);
    try {
      const result = await migratePlaintextCredentials();
      setMigrationResult(result);
      const updated = await refreshVaultStatus();
      onVaultRefresh?.(updated);
    } catch {
      setMigrationResult({ migrated: 0, failed: vault.plaintext });
    } finally {
      setIsMigrating(false);
    }
  }, [vault.plaintext, onVaultRefresh]);

  if (vault.total <= 0) return null;

  const hasPlaintext = vault.plaintext > 0;
  const isKeychain = vault.key_source === 'keychain';

  const badgeClass = `flex items-center gap-1.5 text-[11px] px-2 py-0.5 rounded-md border cursor-pointer transition-colors ${
    hasPlaintext
      ? 'bg-amber-500/10 border-amber-500/20 text-amber-400 hover:bg-amber-500/15'
      : isKeychain
        ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/15'
        : 'bg-yellow-500/10 border-yellow-500/20 text-yellow-400 hover:bg-yellow-500/15'
  }`;

  return (
    <div className="relative" ref={panelRef}>
      <button
        onClick={() => { setOpen(!open); setMigrationResult(null); }}
        className={badgeClass}
      >
        {hasPlaintext ? (
          <><ShieldAlert className="w-3 h-3" />{vault.plaintext} unencrypted</>
        ) : isKeychain ? (
          <><Shield className="w-3 h-3" />Encrypted</>
        ) : (
          <><Shield className="w-3 h-3" />Encrypted (fallback key)</>
        )}
        <ChevronDown className={`w-2.5 h-2.5 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1.5 w-80 rounded-xl bg-background border border-primary/15 shadow-xl z-30 overflow-hidden">
          {/* Header */}
          <div className={`px-4 py-3 border-b ${
            hasPlaintext
              ? 'border-amber-500/15 bg-amber-500/5'
              : isKeychain
                ? 'border-emerald-500/15 bg-emerald-500/5'
                : 'border-yellow-500/15 bg-yellow-500/5'
          }`}>
            <div className="flex items-center gap-2">
              {hasPlaintext ? (
                <ShieldAlert className="w-4 h-4 text-amber-400" />
              ) : (
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
              )}
              <span className="text-sm font-medium text-foreground">
                {hasPlaintext ? 'Vault needs attention' : 'Vault is secure'}
              </span>
            </div>
          </div>

          {/* Stats row */}
          <div className="flex gap-3 px-4 py-2.5 border-b border-primary/10 bg-secondary/20">
            <span className="text-[11px] text-muted-foreground/60">{vault.total} credential{vault.total !== 1 ? 's' : ''}</span>
            <span className="text-[11px] text-emerald-400/70">{vault.encrypted} encrypted</span>
            {hasPlaintext && (
              <span className="text-[11px] text-amber-400/70">{vault.plaintext} unencrypted</span>
            )}
          </div>

          {/* Explainer items */}
          <div className="px-4 py-3 space-y-2.5">
            <ExplainerRow
              icon={<Lock className="w-3.5 h-3.5 text-primary/50" />}
              title="AES-256-GCM encryption"
              detail="Each credential is encrypted with a unique random nonce, producing tamper-proof ciphertext that only this app can decrypt."
            />
            <ExplainerRow
              icon={<KeyRound className="w-3.5 h-3.5 text-primary/50" />}
              title={isKeychain ? 'Master key in OS Keychain' : 'Fallback master key'}
              detail={isKeychain
                ? 'Your master encryption key is stored in the Windows Credential Manager (or macOS Keychain), protected by your OS login.'
                : 'The OS keychain was unavailable, so the master key is derived from your machine identity. Credentials are still encrypted, but OS-level key storage is preferred.'}
            />
            <ExplainerRow
              icon={<HardDrive className="w-3.5 h-3.5 text-primary/50" />}
              title="Credentials never leave this device"
              detail="All secrets are stored in a local SQLite database. Nothing is sent to any server or cloud."
            />
          </div>

          {/* Encrypt Now action for plaintext credentials */}
          {hasPlaintext && !migrationResult && (
            <div className="px-4 pb-3">
              <button
                onClick={handleEncryptNow}
                disabled={isMigrating}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-amber-500/15 border border-amber-500/25 text-amber-300 text-xs font-medium hover:bg-amber-500/25 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isMigrating ? (
                  <><Loader2 className="w-3.5 h-3.5 animate-spin" />Encrypting...</>
                ) : (
                  <><Lock className="w-3.5 h-3.5" />Encrypt {vault.plaintext} unencrypted credential{vault.plaintext !== 1 ? 's' : ''} now</>
                )}
              </button>
            </div>
          )}

          {/* Migration result */}
          {migrationResult && (
            <div className={`mx-4 mb-3 px-3 py-2 rounded-lg text-xs ${
              migrationResult.failed > 0
                ? 'bg-red-500/10 border border-red-500/20 text-red-300'
                : 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-300'
            }`}>
              {migrationResult.failed > 0
                ? `Encrypted ${migrationResult.migrated}, failed ${migrationResult.failed}. Try again or restart the app.`
                : `Done — ${migrationResult.migrated} credential${migrationResult.migrated !== 1 ? 's' : ''} encrypted.`}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ExplainerRow({ icon, title, detail }: { icon: React.ReactNode; title: string; detail: string }) {
  return (
    <div className="flex gap-2.5">
      <div className="mt-0.5 shrink-0">{icon}</div>
      <div>
        <p className="text-xs font-medium text-foreground/80">{title}</p>
        <p className="text-[11px] text-muted-foreground/50 leading-relaxed">{detail}</p>
      </div>
    </div>
  );
}
