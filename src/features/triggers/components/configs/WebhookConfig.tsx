import { useState } from 'react';
import { Eye, EyeOff, Copy, CheckCircle2 } from 'lucide-react';

export interface WebhookConfigProps {
  hmacSecret: string;
  setHmacSecret: (v: string) => void;
}

export function WebhookConfig({ hmacSecret, setHmacSecret }: WebhookConfigProps) {
  const [showHmacSecret, setShowHmacSecret] = useState(false);
  const [copiedHmac, setCopiedHmac] = useState(false);

  const copyHmacSecret = async () => {
    if (!hmacSecret) return;
    try {
      await navigator.clipboard.writeText(hmacSecret);
      setCopiedHmac(true);
      setTimeout(() => setCopiedHmac(false), 2000);
    } catch {
      // intentional: non-critical — clipboard write best-effort
    }
  };

  return (
    <div className="space-y-3">
      <div>
        <label className="block text-sm font-medium text-foreground/80 mb-1.5">
          HMAC Secret (optional)
        </label>
        <div className="relative flex items-center gap-1.5">
          <div className="relative flex-1">
            <input
              type={showHmacSecret ? 'text' : 'password'}
              value={hmacSecret}
              onChange={(e) => setHmacSecret(e.target.value)}
              placeholder="Leave empty for no signature verification"
              className={`w-full px-3 py-2 pr-10 bg-background/50 border border-primary/15 rounded-xl text-foreground placeholder-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/40 transition-all ${showHmacSecret ? 'font-mono text-sm' : ''}`}
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
        <p className="text-sm text-muted-foreground/80 mt-1">If set, incoming webhooks must include x-hub-signature-256 header</p>
      </div>
      <div className="p-3 bg-background/30 rounded-xl border border-primary/10">
        <p className="text-sm text-muted-foreground/90">A unique webhook URL will be shown after creation with a copy button</p>
      </div>
    </div>
  );
}
