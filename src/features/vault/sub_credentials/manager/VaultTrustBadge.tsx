import { useCallback, useEffect, useState } from 'react';
import { ShieldCheck, ShieldAlert, ChevronDown, Lock, KeyRound, HardDrive, Sparkles } from 'lucide-react';
import AsyncButton from '@/features/shared/components/buttons/AsyncButton';
import { vaultStatus, migratePlaintextCredentials, type VaultStatus } from '@/api/vault/credentials';
import { useTranslation } from '@/i18n/useTranslation';
import { silentCatch, toastCatch } from '@/lib/silentCatch';

/**
 * Standing trust panel for the credentials list. Surfaces two things the
 * backend already computes but nothing rendered (UAT L1 F-VAULT-TRUST-COPY-DEAD
 * + F-VAULT-STATUS-COUNTERS): the reviewer-grade AES-256-GCM / OS-keychain /
 * local-only trust copy (authored in all 14 locales under vault.vault_badge but
 * previously consumed by zero components), and the vault_status counters
 * (encrypted / plaintext / legacy-IPC) — reachable in a shipping build, unlike
 * the dev-only Admin tab. The plaintext count carries an inline Encrypt-now CTA.
 */
export function VaultTrustBadge() {
  const { t, tx } = useTranslation();
  const b = t.vault.vault_badge;
  const [status, setStatus] = useState<VaultStatus | null>(null);
  const [open, setOpen] = useState(false);
  const [migrating, setMigrating] = useState(false);

  const refresh = useCallback(() => {
    vaultStatus().then(setStatus).catch(silentCatch('VaultTrustBadge.vaultStatus'));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (!status) return null;

  const fallbackKey = status.key_source !== 'keychain';
  const plaintext = status.plaintext;
  const legacyIpc = status.legacy_ipc_decrypt_calls;
  const needsAttention = plaintext > 0 || fallbackKey || legacyIpc > 0;

  const onEncrypt = async () => {
    setMigrating(true);
    try {
      await migratePlaintextCredentials();
      refresh();
    } catch (e) {
      toastCatch('VaultTrustBadge.migrate')(e);
    } finally {
      setMigrating(false);
    }
  };

  return (
    <div className="mx-4 md:mx-6 xl:mx-8 mt-3">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        data-testid="vault-trust-badge"
        className={`w-full flex items-center gap-2 px-3 py-2 rounded-card border typo-body transition-colors text-left ${
          needsAttention
            ? 'border-amber-500/25 bg-amber-500/5 hover:bg-amber-500/10'
            : 'border-emerald-500/20 bg-emerald-500/5 hover:bg-emerald-500/10'
        }`}
      >
        {needsAttention ? (
          <ShieldAlert className="w-4 h-4 shrink-0 text-amber-400" />
        ) : (
          <ShieldCheck className="w-4 h-4 shrink-0 text-emerald-400" />
        )}
        <span className={`font-medium ${needsAttention ? 'text-amber-300' : 'text-emerald-300'}`}>
          {needsAttention ? b.vault_needs_attention : b.vault_secure}
        </span>
        <span className="text-foreground">
          {plaintext > 0 ? tx(b.unencrypted, { count: plaintext }) : b.encrypted}
        </span>
        <ChevronDown
          className={`w-3.5 h-3.5 ml-auto shrink-0 text-foreground transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className="mt-1.5 px-3 py-3 rounded-card border border-primary/10 bg-secondary/20 space-y-3">
          <TrustRow icon={<Lock className="w-3.5 h-3.5" />} title={b.aes_title} detail={b.aes_detail} />
          <TrustRow
            icon={<KeyRound className="w-3.5 h-3.5" />}
            title={fallbackKey ? b.fallback_key_title : b.keychain_title}
            detail={fallbackKey ? b.fallback_key_detail : b.keychain_detail}
            warn={fallbackKey}
          />
          <TrustRow icon={<HardDrive className="w-3.5 h-3.5" />} title={b.local_title} detail={b.local_detail} />

          {legacyIpc > 0 && (
            <div className="typo-caption text-amber-300/80">{tx(b.legacy_ipc, { count: legacyIpc })}</div>
          )}

          {plaintext > 0 && (
            <AsyncButton
              variant="secondary"
              size="sm"
              isLoading={migrating}
              loadingText={b.encrypting}
              icon={<Sparkles className="w-3.5 h-3.5" />}
              onClick={onEncrypt}
            >
              {tx(plaintext === 1 ? b.encrypt_now_one : b.encrypt_now_other, { count: plaintext })}
            </AsyncButton>
          )}
        </div>
      )}
    </div>
  );
}

function TrustRow({
  icon,
  title,
  detail,
  warn,
}: {
  icon: React.ReactNode;
  title: string;
  detail: string;
  warn?: boolean;
}) {
  return (
    <div className="flex items-start gap-2">
      <span className={`mt-0.5 shrink-0 ${warn ? 'text-amber-400' : 'text-emerald-400/80'}`}>{icon}</span>
      <div className="min-w-0">
        <div className="typo-body font-medium text-foreground/90">{title}</div>
        <div className="typo-caption text-foreground">{detail}</div>
      </div>
    </div>
  );
}
