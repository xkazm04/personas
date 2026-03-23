import { useState, useCallback } from 'react';
import { Eye, EyeOff, Copy, CheckCircle2, RefreshCw } from 'lucide-react';
import { TriggerFieldGroup } from './TriggerFieldGroup';

export interface WebhookConfigProps {
  hmacSecret: string;
  setHmacSecret: (v: string) => void;
}

export function WebhookConfig({ hmacSecret, setHmacSecret }: WebhookConfigProps) {
  const [showHmacSecret, setShowHmacSecret] = useState(false);
  const [copiedHmac, setCopiedHmac] = useState(false);

  const generateSecret = useCallback(() => {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    setHmacSecret(Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(''));
    setShowHmacSecret(true);
  }, [setHmacSecret]);

  const copyHmacSecret = async () => {
    if (!hmacSecret) return;
    try {
      await navigator.clipboard.writeText(hmacSecret);
      setCopiedHmac(true);
      setTimeout(() => setCopiedHmac(false), 2000);
    } catch {
      // intentional: non-critical -- clipboard write best-effort
    }
  };

  return (
    <div className="space-y-3">
      <TriggerFieldGroup
        label="HMAC Secret"
        helpText="Incoming webhooks must include a valid HMAC signature header. A secret will be auto-generated if left empty."
      >
        <div className="relative flex items-center gap-1.5">
          <div className="relative flex-1">
            <input
              type={showHmacSecret ? 'text' : 'password'}
              value={hmacSecret}
              onChange={(e) => setHmacSecret(e.target.value)}
              placeholder="Auto-generated if left empty"
              className={`w-full px-3 py-2 pr-10 bg-background/50 border border-primary/15 rounded-xl text-foreground placeholder-muted-foreground/30 focus-ring focus-visible:border-primary/40 transition-all ${showHmacSecret ? 'font-mono text-sm' : ''}`}
            />
            <button
              type="button"
              onClick={() => setShowHmacSecret(!showHmacSecret)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-muted-foreground/90 hover:text-foreground/95 transition-colors"
              title={showHmacSecret ? 'Hide secret' : 'Show secret'}
            >
              {showHmacSecret ? (
                <EyeOff className="w-4 h-4" />
              ) : (
                <Eye className="w-4 h-4" />
              )}
            </button>
          </div>
          <button
            type="button"
            onClick={generateSecret}
            className="flex-shrink-0 p-2 rounded-xl border transition-all bg-background/50 border-primary/15 text-muted-foreground/90 hover:text-foreground/95 hover:border-primary/30"
            title="Generate random secret"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          {hmacSecret && (
            <button
              type="button"
              onClick={copyHmacSecret}
              className={`flex-shrink-0 p-2 rounded-xl border transition-all ${
                copiedHmac
                  ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20'
                  : 'bg-background/50 border-primary/15 text-muted-foreground/90 hover:text-foreground/95 hover:border-primary/30'
              }`}
              title={copiedHmac ? 'Copied!' : 'Copy secret'}
            >
              {copiedHmac ? (
                <CheckCircle2 className="w-4 h-4" />
              ) : (
                <Copy className="w-4 h-4" />
              )}
            </button>
          )}
        </div>
      </TriggerFieldGroup>
      <div className="p-3 bg-background/30 rounded-xl border border-primary/10">
        <p className="text-sm text-muted-foreground/90">A unique webhook URL will be shown after creation with a copy button</p>
      </div>
    </div>
  );
}
