import { useState, useCallback } from 'react';
import { Eye, EyeOff, Copy, CheckCircle2, RefreshCw } from 'lucide-react';
import { TriggerFieldGroup } from './TriggerFieldGroup';
import { useTranslation } from '@/i18n/useTranslation';
import { useCopyToClipboard } from '@/hooks/utility/interaction/useCopyToClipboard';
import Button from '@/features/shared/components/buttons/Button';
import { Tooltip } from '@/features/shared/components/display/Tooltip';

export interface WebhookConfigProps {
  hmacSecret: string;
  setHmacSecret: (v: string) => void;
}

export function WebhookConfig({ hmacSecret, setHmacSecret }: WebhookConfigProps) {
  const { t } = useTranslation();
  const [showHmacSecret, setShowHmacSecret] = useState(false);
  const { copied: copiedHmac, copy } = useCopyToClipboard();

  const generateSecret = useCallback(() => {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    setHmacSecret(Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(''));
    setShowHmacSecret(true);
  }, [setHmacSecret]);

  const copyHmacSecret = () => {
    if (!hmacSecret) return;
    copy(hmacSecret);
  };

  return (
    <div className="space-y-3">
      <TriggerFieldGroup
        label={t.triggers.hmac_secret_label}
        helpText={t.triggers.hmac_help}
      >
        <div className="relative flex items-center gap-1.5">
          <div className="relative flex-1">
            <input
              type={showHmacSecret ? 'text' : 'password'}
              value={hmacSecret}
              onChange={(e) => setHmacSecret(e.target.value)}
              placeholder={t.triggers.auto_generated_hint}
              className={`w-full px-3 py-2 pr-10 bg-background/50 border border-hair rounded-modal text-ink-1 placeholder-ink-3 focus-ring focus-visible:border-primary/40 transition-all ${showHmacSecret ? 'typo-code' : ''}`}
            />
            <Tooltip content={showHmacSecret ? t.triggers.hide_secret : t.triggers.show_secret}><button
              type="button"
              onClick={() => setShowHmacSecret(!showHmacSecret)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-ink-1 hover:text-ink-1 transition-colors">
              {showHmacSecret ? (
                <EyeOff className="w-4 h-4" />
              ) : (
                <Eye className="w-4 h-4" />
              )}
            </button></Tooltip>
          </div>
          <Button aria-label={t.triggers.generate_secret}
            type="button"
            onClick={generateSecret}
            tooltip={t.triggers.generate_secret}
            variant="secondary"
            size="icon-sm"
            className="flex-shrink-0"
            icon={<RefreshCw className="w-4 h-4" />}
          />
          {hmacSecret && (
            <Tooltip content={copiedHmac ? t.common.copied : t.common.copy}><Button
  type="button"
  onClick={copyHmacSecret}
  variant={copiedHmac ? 'secondary' : 'ghost'}
  size="icon-sm"
  className="flex-shrink-0"
  icon={copiedHmac ? (
                <CheckCircle2 className="w-4 h-4" />
              ) : (
                <Copy className="w-4 h-4" />
              )}
/></Tooltip>
          )}
        </div>
      </TriggerFieldGroup>
      <div className="p-3 bg-background/30 rounded-modal border border-hair">
        <p className="typo-body text-ink-1">{t.triggers.webhook_url_note}</p>
      </div>
    </div>
  );
}
