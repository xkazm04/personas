import { useCallback, useEffect, useState } from 'react';
import { ShieldCheck, ShieldAlert, ChevronDown, Lock, KeyRound, HardDrive, FileWarning } from 'lucide-react';
import { vaultStatus, type VaultStatus } from '@/api/vault/credentials';
import { useTranslation } from '@/i18n/useTranslation';
import { silentCatch } from '@/lib/silentCatch';

/**
 * Standing trust-story panel for the credentials list. Surfaces the
 * reviewer-grade vault.vault_badge copy (AES-256-GCM / OS-keychain / local-only)
 * that was authored in all 14 locales but consumed by zero components — the
 * trust STORY buyers and security reviewers want visible (UAT L1
 * F-VAULT-TRUST-COPY-DEAD).
 *
 * Deliberately a calm DISPLAY, never a control. Encryption is automatic and
 * silent by design — startup runs migrate_plaintext_credentials +
 * assure_sensitive_fields_encrypted, so plaintext is ~always 0 (see
 * docs/features/connections/README.md). There is intentionally NO "encrypt now"
 * button and NO unencrypted-count badge here (the former VaultStatusBadge was
 * removed for that reason); this panel only reassures, and reflects the
 * OS-keychain vs machine-fallback master-key state accurately.
 */
export function VaultTrustBadge() {
  const { t, tx } = useTranslation();
  const b = t.vault.vault_badge;
  const [status, setStatus] = useState<VaultStatus | null>(null);
  const [open, setOpen] = useState(false);

  const refresh = useCallback(() => {
    vaultStatus().then(setStatus).catch(silentCatch('VaultTrustBadge.vaultStatus'));
  }, []);

  useEffect(() => {
    refresh();
    // Mount-only fetch left the badge permanently green while the tab stayed
    // open — an audit-write failure during a live run never flipped it amber
    // until a remount (2026-07-16 UAT T-1). A slow poll keeps the honesty
    // signal live without meaningful cost; refresh-on-focus covers the
    // "left it open overnight" case.
    const interval = setInterval(refresh, 60_000);
    window.addEventListener('focus', refresh);
    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', refresh);
    };
  }, [refresh]);

  if (!status) return null;

  // The only status detail this calm display uses: which master-key path is
  // active (OS keychain vs the machine-derived fallback). Both keep credentials
  // encrypted; the keychain path is preferred, so the fallback gets a soft note.
  const fallbackKey = status.key_source !== 'keychain';
  // Failed audit-log writes this session (mirrors the legacy-IPC counter
  // surfaced on vault_status). Decrypts are never blocked by audit failures,
  // but a non-zero count means some access events are missing from the audit
  // trail — an honesty signal this badge must not hide behind a green shield.
  const auditGaps = status.credential_audit_write_failures ?? 0;
  const attention = auditGaps > 0;

  return (
    <div className="mx-4 md:mx-6 xl:mx-8 mt-3">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        data-testid="vault-trust-badge"
        className={`w-full flex items-center gap-2 px-3 py-2 rounded-card border typo-body transition-colors text-left ${
          attention
            ? 'border-amber-500/20 bg-amber-500/5 hover:bg-amber-500/10'
            : 'border-emerald-500/20 bg-emerald-500/5 hover:bg-emerald-500/10'
        }`}
      >
        {attention ? (
          <ShieldAlert className="w-4 h-4 shrink-0 text-amber-400" />
        ) : (
          <ShieldCheck className="w-4 h-4 shrink-0 text-emerald-400" />
        )}
        <span className={`font-medium ${attention ? 'text-amber-300' : 'text-emerald-300'}`}>
          {attention ? b.vault_needs_attention : b.vault_secure}
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
          {attention && (
            <TrustRow
              icon={<FileWarning className="w-3.5 h-3.5" />}
              title={b.audit_gap_title}
              detail={tx(b.audit_gap_detail, { count: auditGaps })}
              warn
            />
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
