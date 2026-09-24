/**
 * Reviewed bulk retire for dead cloud-app pairings.
 *
 * Retiring revokes credentials, so the dialog is built around one invariant:
 * what it lists is exactly what it revokes. The plan is computed once when the
 * dialog opens and frozen; a background reload of the key list cannot add a
 * key between the operator's review and the confirm. The plan itself comes
 * from `retirePlan`, which only ever holds expired or superseded origin-bound
 * keys, never a regular key and never an origin's newest live pairing.
 */
import { useState } from 'react';
import { AlertTriangle, Globe, Unplug } from 'lucide-react';
import { BaseModal } from '@/lib/ui/BaseModal';
import Button from '@/features/shared/components/buttons/Button';
import AsyncButton from '@/features/shared/components/buttons/AsyncButton';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { useTranslation } from '@/i18n/useTranslation';
import type { ExternalApiKey } from '@/api/auth/externalApiKeys';
import { retirePlan, runRetire, type RetireCandidate, type RetireOutcome } from '../libs/keyLifecycle';

interface RetireKeysDialogProps {
  /** The key list as the page last loaded it; read once, when the dialog opens. */
  keys: readonly ExternalApiKey[];
  now?: number;
  revoke: (id: string) => Promise<unknown>;
  onClose: () => void;
  /** Called once the pass settles, so the page can reload the key list. */
  onDone: (outcome: RetireOutcome) => void;
}

export function RetireKeysDialog({ keys, now, revoke, onClose, onDone }: RetireKeysDialogProps) {
  const { t, tx } = useTranslation();
  const s = t.settings.api_keys;
  const [plan] = useState<RetireCandidate[]>(() => retirePlan(keys, now ?? Date.now()));
  const [outcome, setOutcome] = useState<RetireOutcome | null>(null);

  const confirm = async () => {
    const out = await runRetire(
      plan.map((c) => c.key.id),
      revoke,
    );
    setOutcome(out);
    onDone(out);
  };

  const prefixOf = (id: string) => plan.find((c) => c.key.id === id)?.key.key_prefix ?? id;

  return (
    <BaseModal isOpen onClose={onClose} titleId="retire-keys-title" size="md" portal>
      <div className="p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Unplug className="w-4 h-4 text-red-400" />
          <h2 id="retire-keys-title" className="typo-heading text-foreground">
            {s.retire_title}
          </h2>
        </div>
        <p className="typo-body text-foreground">{s.retire_body}</p>

        <ul className="space-y-1 max-h-72 overflow-y-auto">
          {plan.map((c) => (
            <li
              key={c.key.id}
              data-testid="retire-row"
              data-key-id={c.key.id}
              className="flex items-center gap-2 px-2.5 py-1.5 rounded-input border border-border/30 bg-secondary/20"
            >
              <Globe className="w-3.5 h-3.5 text-sky-400 shrink-0" />
              <code className="typo-code text-foreground truncate min-w-0 flex-1">{c.key.bound_origin}</code>
              <code className="typo-code text-foreground">{c.key.key_prefix}</code>
              <RelativeTime timestamp={c.key.created_at} className="typo-caption text-foreground" />
              <span
                className={`typo-caption px-1.5 py-0.5 rounded shrink-0 ${
                  c.reason === 'expired' ? 'text-red-400 bg-red-400/10' : 'text-amber-400 bg-amber-400/10'
                }`}
              >
                {c.reason === 'expired' ? s.retire_reason_expired : s.retire_reason_superseded}
              </span>
            </li>
          ))}
        </ul>

        {/* The live region is mounted with the dialog; only its text arrives with the outcome. */}
        <div className="space-y-1" role="status">
          {outcome && (
            <>
              <p className="typo-body text-foreground">
                {tx(s.retire_result, { retired: outcome.retired.length, total: plan.length })}
              </p>
              {outcome.failed.length > 0 && (
                <div className="rounded-card border border-red-400/30 bg-red-400/5 p-2 space-y-1">
                  <p className="flex items-center gap-1.5 typo-caption text-red-400">
                    <AlertTriangle size={12} />
                    {s.retire_failed_label}
                  </p>
                  {outcome.failed.map((f) => (
                    <p key={f.id} className="flex items-center gap-2 typo-caption text-foreground">
                      <code className="typo-code">{prefixOf(f.id)}</code>
                      <span>{f.message}</span>
                    </p>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 pt-1">
          {outcome ? (
            <Button variant="secondary" onClick={onClose} data-testid="retire-close">
              {s.close}
            </Button>
          ) : (
            <>
              <Button variant="ghost" onClick={onClose}>
                {s.cancel}
              </Button>
              <AsyncButton
                variant="danger"
                onClick={confirm}
                disabled={plan.length === 0}
                data-testid="retire-confirm"
              >
                {tx(s.retire_confirm, { count: plan.length })}
              </AsyncButton>
            </>
          )}
        </div>
      </div>
    </BaseModal>
  );
}
