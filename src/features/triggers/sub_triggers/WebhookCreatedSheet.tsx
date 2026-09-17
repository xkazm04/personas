/**
 * One-time reveal of a freshly-created webhook trigger's HMAC secret.
 *
 * `buildTriggerConfig` mints a 32-byte hex secret when the user leaves the
 * field blank (`s.hmacSecret || generateWebhookSecret()`), and until this sheet
 * existed that secret was never shown: the form closed, and the only later
 * surface renders `--------` plus its last four characters. The first webhook
 * is the flagship external integration and it could not be pasted into GitHub
 * or Stripe on the same turn it was made.
 *
 * Closing is irreversible for the plaintext — the secret is encrypted at rest
 * (`core/src/crypto.rs` SENSITIVE_TRIGGER_KEYS) and the drawer keeps last-4
 * only — so the sheet says so rather than implying it can be reopened.
 *
 * The curl sample is GitHub-shaped on purpose: the receiver accepts
 * `x-hub-signature-256`, `x-signature-256` or `x-webhook-signature`, each
 * carrying `sha256=<hex>` over the raw body (`engine/webhook.rs:427-455`).
 */
import { AlertTriangle, CheckCircle2, X } from 'lucide-react';
import { BaseModal } from '@/lib/ui/BaseModal';
import { CopyButton } from '@/features/shared/components/buttons/CopyButton';
import { Button } from '@/features/shared/components/buttons';
import { useTranslation } from '@/i18n/useTranslation';
import { getWebhookUrl, IS_WEBHOOK_LOCALHOST } from '@/lib/utils/platform/triggerConstants';

export interface WebhookCreatedSheetProps {
  /** Id of the trigger that was just created — the URL's only variable part. */
  triggerId: string;
  /** Plaintext secret as it was submitted. Never re-read from the row. */
  secret: string;
  onClose: () => void;
  /** Opens the relay tab, where a loopback install gets a public path. */
  onOpenRelay?: () => void;
}

/** The signed request a sender has to reproduce, as a copy-pasteable script. */
export function buildSignedCurlSample(url: string, secret: string): string {
  return [
    `BODY='{"event":"ping"}'`,
    `SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac '${secret}' | sed 's/^.* //')`,
    `curl -X POST ${url} \\`,
    `  -H 'Content-Type: application/json' \\`,
    `  -H "x-hub-signature-256: sha256=$SIG" \\`,
    `  -d "$BODY"`,
  ].join('\n');
}

export function WebhookCreatedSheet({ triggerId, secret, onClose, onOpenRelay }: WebhookCreatedSheetProps) {
  const { t } = useTranslation();
  const url = getWebhookUrl(triggerId);
  const curl = buildSignedCurlSample(url, secret);

  return (
    <BaseModal isOpen onClose={onClose} titleId="webhook-created-title" size="lg" portal>
      <div className="flex flex-col max-h-[80vh]" data-testid="webhook-created-sheet">
        <div className="flex items-start gap-2.5 px-4 py-3 border-b border-card-border/60 shrink-0">
          <CheckCircle2 className="w-4 h-4 text-status-success mt-0.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <h2 id="webhook-created-title" className="typo-label text-foreground">
              {t.triggers.webhook_created_title}
            </h2>
            <p className="typo-caption text-foreground/85 mt-0.5">
              {t.triggers.webhook_created_once_warning}
            </p>
          </div>
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label={t.common.close}>
            <X className="w-3.5 h-3.5" />
          </Button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin px-4 py-4 space-y-4">
          <CopyableLine label={t.triggers.webhook_created_url_label} text={url} testId="webhook-created-url" />
          <CopyableLine label={t.triggers.hmac_secret_label} text={secret} testId="webhook-created-secret" />

          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="typo-label text-foreground">{t.triggers.webhook_created_curl_label}</span>
              <CopyButton text={curl} tooltip={t.triggers.webhook_created_copy_curl} />
            </div>
            <pre
              data-testid="webhook-created-curl"
              className="px-3 py-2 rounded-card border border-card-border bg-secondary/40 typo-code font-mono text-foreground overflow-x-auto whitespace-pre"
            >
              {curl}
            </pre>
          </div>

          {IS_WEBHOOK_LOCALHOST && (
            <div
              data-testid="webhook-created-localhost-warning"
              className="px-3 py-2.5 rounded-card border border-status-warning/35 bg-status-warning/10"
            >
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-status-warning mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="typo-label text-status-warning">{t.triggers.webhook_created_local_title}</div>
                  <div className="typo-caption text-foreground/85 mt-0.5">
                    {t.triggers.webhook_created_local_body}
                  </div>
                  {onOpenRelay && (
                    <Button variant="ghost" size="sm" className="mt-2" onClick={onOpenRelay}>
                      {t.triggers.webhook_created_open_relay}
                    </Button>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-card-border/60 shrink-0">
          <Button variant="primary" size="sm" onClick={onClose}>
            {t.triggers.webhook_created_done}
          </Button>
        </div>
      </div>
    </BaseModal>
  );
}

/** A labelled, monospaced, copy-to-clipboard line. `text` rather than `value`
 *  on purpose: this is the literal string the operator pastes elsewhere, not a
 *  measurement — it is never absent and never rendered as a number. */
function CopyableLine({ label, text, testId }: { label: string; text: string; testId: string }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <span className="typo-label text-foreground">{label}</span>
        <CopyButton text={text} />
      </div>
      <div
        data-testid={testId}
        className="px-3 py-2 rounded-input border border-card-border bg-secondary/40 typo-code font-mono text-foreground break-all select-all"
      >
        {text}
      </div>
    </div>
  );
}
