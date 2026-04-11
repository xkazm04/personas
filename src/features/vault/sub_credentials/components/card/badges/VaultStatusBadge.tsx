import { useState, useCallback, useRef, useEffect } from 'react';
import { Shield, ShieldAlert, ShieldCheck, ChevronDown, Lock, KeyRound, HardDrive } from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { useTier } from '@/hooks/utility/interaction/useTier';
import type { VaultStatus } from "@/api/vault/credentials";
import { migratePlaintextCredentials, vaultStatus as refreshVaultStatus } from "@/api/vault/credentials";
import { useTranslation } from '@/i18n/useTranslation';


interface VaultStatusBadgeProps {
  vault: VaultStatus;
  onVaultRefresh?: (updated: VaultStatus) => void;
}

export function VaultStatusBadge({ vault, onVaultRefresh }: VaultStatusBadgeProps) {
  const { t, tx } = useTranslation();
  const { isStarter: isSimple } = useTier();
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
      // User feedback via migrationResult banner rendered below
      setMigrationResult({ migrated: 0, failed: vault.plaintext });
    } finally {
      setIsMigrating(false);
    }
  }, [vault.plaintext, onVaultRefresh]);

  if (vault.total <= 0) return null;

  const hasPlaintext = vault.plaintext > 0;

  // Simple mode: just a static badge, no dropdown
  if (isSimple) {
    return (
      <span className={`flex items-center gap-1.5 text-xs px-2 py-1.5 rounded-lg border ${
        hasPlaintext
          ? 'bg-amber-500/10 border-amber-500/20 text-amber-400'
          : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
      }`}>
        {hasPlaintext ? <ShieldAlert className="w-3 h-3" /> : <Shield className="w-3 h-3" />}
        {hasPlaintext ? t.vault.vault_badge.needs_attention : t.vault.vault_badge.secure}
      </span>
    );
  }
  const isKeychain = vault.key_source === 'keychain';

  const badgeClass = `flex items-center gap-1.5 text-xs px-2 py-1.5 rounded-lg border cursor-pointer transition-colors ${
    hasPlaintext
      ? 'bg-amber-500/10 border-amber-500/20 text-amber-400 hover:bg-amber-500/15 hover:border-amber-500/30'
      : isKeychain
        ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/15 hover:border-emerald-500/30'
        : 'bg-yellow-500/10 border-yellow-500/20 text-yellow-400 hover:bg-yellow-500/15 hover:border-yellow-500/30'
  }`;

  return (
    <div className="relative" ref={panelRef}>
      <button
        onClick={() => { setOpen(!open); setMigrationResult(null); }}
        className={badgeClass}
      >
        {hasPlaintext ? (
          <><ShieldAlert className="w-3 h-3" />{tx(t.vault.vault_badge.unencrypted, { count: vault.plaintext })}</>
        ) : isKeychain ? (
          <><Shield className="w-3 h-3" />{t.vault.vault_badge.encrypted}</>
        ) : (
          <><Shield className="w-3 h-3" />{t.vault.vault_badge.encrypted_fallback}</>
        )}
        <ChevronDown className={`w-2.5 h-2.5 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1.5 w-80 rounded-xl bg-background border border-primary/15 shadow-elevation-3 z-30 overflow-hidden">
          {/* Header */}
          <div className={`px-4 py-3 border-b ${
            hasPlaintext
              ? 'border-amber-500/20 bg-amber-500/10'
              : isKeychain
                ? 'border-emerald-500/20 bg-emerald-500/10'
                : 'border-yellow-500/20 bg-yellow-500/10'
          }`}>
            <div className="flex items-center gap-2">
              {hasPlaintext ? (
                <ShieldAlert className="w-4 h-4 text-amber-400" />
              ) : (
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
              )}
              <span className="text-sm font-medium text-foreground">
                {hasPlaintext ? t.vault.vault_badge.vault_needs_attention : t.vault.vault_badge.vault_secure}
              </span>
            </div>
          </div>

          {/* Stats row */}
          <div className="flex gap-3 px-4 py-2.5 border-b border-primary/10 bg-secondary/20">
            <span className="text-sm text-muted-foreground/80">{vault.total} credential{vault.total !== 1 ? 's' : ''}</span>
            <span className="text-sm text-emerald-400/70">{vault.encrypted} encrypted</span>
            {hasPlaintext && (
              <span className="text-sm text-amber-400/70">{vault.plaintext} unencrypted</span>
            )}
          </div>

          {/* Explainer items */}
          <div className="px-4 py-3 space-y-2.5">
            <ExplainerRow
              icon={<Lock className="w-3.5 h-3.5 text-primary/50" />}
              title={t.vault.vault_badge.aes_title}
              detail={t.vault.vault_badge.aes_detail}
            />
            <ExplainerRow
              icon={<KeyRound className="w-3.5 h-3.5 text-primary/50" />}
              title={isKeychain ? t.vault.vault_badge.keychain_title : t.vault.vault_badge.fallback_key_title}
              detail={isKeychain
                ? t.vault.vault_badge.keychain_detail
                : t.vault.vault_badge.fallback_key_detail}
            />
            <ExplainerRow
              icon={<HardDrive className="w-3.5 h-3.5 text-primary/50" />}
              title={t.vault.vault_badge.local_title}
              detail={t.vault.vault_badge.local_detail}
            />
          </div>

          {/* Encrypt Now action for plaintext credentials */}
          {hasPlaintext && !migrationResult && (
            <div className="px-4 pb-3">
              <button
                onClick={handleEncryptNow}
                disabled={isMigrating}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 text-sm font-medium hover:bg-amber-500/15 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isMigrating ? (
                  <><LoadingSpinner size="sm" />{t.vault.vault_badge.encrypting}</>
                ) : (
                  <><Lock className="w-3.5 h-3.5" />{tx(vault.plaintext === 1 ? t.vault.vault_badge.encrypt_now_one : t.vault.vault_badge.encrypt_now_other, { count: vault.plaintext })}</>
                )}
              </button>
            </div>
          )}

          {/* Migration result */}
          {migrationResult && (
            <div className={`mx-4 mb-3 px-3 py-2 rounded-xl text-sm ${
              migrationResult.failed > 0
                ? 'bg-red-500/10 border border-red-500/20 text-red-300'
                : 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-300'
            }`}>
              {migrationResult.failed > 0
                ? `Encrypted ${migrationResult.migrated}, failed ${migrationResult.failed}. Try again or restart the app.`
                : `Done -- ${migrationResult.migrated} credential${migrationResult.migrated !== 1 ? 's' : ''} encrypted.`}
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
        <p className="text-sm font-medium text-foreground/80">{title}</p>
        <p className="text-sm text-muted-foreground/90 leading-relaxed">{detail}</p>
      </div>
    </div>
  );
}
