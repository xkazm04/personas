/**
 * One-time plaintext display for a freshly-created API key.
 *
 * The plaintext token leaves the backend exactly once; this dialog is
 * the single moment the user can see and copy it. Closing requires an
 * explicit "I have stored this" acknowledgement so the dialog isn't
 * dismissed accidentally before the user has the value.
 *
 * Also surfaces the MCP-config snippet (Claude Code style) with the new
 * key pre-substituted so the user can paste it straight into their
 * config file.
 */
import { useCallback, useState } from 'react';
import { copyText } from '@/hooks/utility/interaction/useCopyToClipboard';
import { Copy, Check, AlertTriangle, X } from 'lucide-react';
import type { CreateApiKeyResponse } from '@/api/auth/externalApiKeys';
import { useTranslation } from '@/i18n/useTranslation';
import { silentCatch } from '@/lib/silentCatch';


interface CreatedKeyDialogProps {
  response: CreateApiKeyResponse;
  onClose: () => void;
}

const MCP_BASE_URL = 'http://127.0.0.1:9420';

export function CreatedKeyDialog({ response, onClose }: CreatedKeyDialogProps) {
  const { t } = useTranslation();
  const s = t.settings.api_keys;

  const [acknowledged, setAcknowledged] = useState(false);
  const [keyCopied, setKeyCopied] = useState(false);
  const [configCopied, setConfigCopied] = useState(false);

  const mcpConfig = JSON.stringify(
    {
      mcpServers: {
        'personas-build': {
          command: 'python',
          args: ['<path-to>/personas/tools/build-mcp/server.py'],
          env: {
            PERSONAS_API_KEY: response.plaintext_token,
            PERSONAS_API_BASE: MCP_BASE_URL,
          },
        },
      },
    },
    null,
    2,
  );

  const copyKey = useCallback(async () => {
    try {
      await copyText(response.plaintext_token);
      setKeyCopied(true);
      setTimeout(() => setKeyCopied(false), 2000);
    } catch (err) { silentCatch("features/settings/sub_api_keys/components/CreatedKeyDialog:catch1")(err); }
  }, [response.plaintext_token]);

  const copyConfig = useCallback(async () => {
    try {
      await copyText(mcpConfig);
      setConfigCopied(true);
      setTimeout(() => setConfigCopied(false), 2000);
    } catch (err) { silentCatch("features/settings/sub_api_keys/components/CreatedKeyDialog:catch2")(err); }
  }, [mcpConfig]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 surface-blur-modal"
      // No dismiss-on-backdrop-click — the user must explicitly acknowledge
      // they've stored the plaintext, since this is the only time we'll
      // show it.
    >
      <div className="bg-secondary border border-border/40 rounded-modal shadow-elevation-3 w-full max-w-lg mx-4">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/30">
          <h2 className="typo-body font-medium text-foreground inline-flex items-center gap-2">
            <Check className="w-4 h-4 text-emerald-400" />
            {s.created_dialog_title}
          </h2>
          {acknowledged && (
            <button
              type="button"
              onClick={onClose}
              className="text-foreground hover:text-foreground transition-colors"
              aria-label={s.close}
            >
              <X size={16} />
            </button>
          )}
        </div>

        <div className="p-4 space-y-4">
          <div className="flex items-start gap-2 typo-caption text-amber-400 bg-amber-400/10 rounded p-2.5">
            <AlertTriangle size={14} className="shrink-0 mt-0.5" />
            <span>{s.created_warning}</span>
          </div>

          <div>
            <label className="block typo-caption text-foreground mb-1.5">
              {s.created_key_label}
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={response.plaintext_token}
                readOnly
                className="flex-1 px-3 py-2 bg-background border border-border/40 rounded-input typo-code text-foreground select-all focus:outline-none focus:border-primary/60"
                onFocus={(e) => e.currentTarget.select()}
              />
              <button
                type="button"
                onClick={copyKey}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-interactive bg-primary text-primary-foreground typo-caption font-medium hover:opacity-90 transition-opacity"
              >
                {keyCopied ? (
                  <>
                    <Check size={12} />
                    {s.copied}
                  </>
                ) : (
                  <>
                    <Copy size={12} />
                    {s.copy}
                  </>
                )}
              </button>
            </div>
            <p className="typo-caption text-foreground mt-1">{s.created_key_hint}</p>
          </div>

          <div>
            <label className="block typo-caption text-foreground mb-1.5">
              {s.created_mcp_config_label}
            </label>
            <pre className="px-3 py-2 bg-background border border-border/40 rounded-input typo-code text-foreground/90 overflow-x-auto text-xs leading-relaxed max-h-48">
              {mcpConfig}
            </pre>
            <button
              type="button"
              onClick={copyConfig}
              className="mt-1.5 inline-flex items-center gap-1.5 typo-caption text-primary hover:opacity-80 transition-opacity"
            >
              {configCopied ? (
                <>
                  <Check size={12} />
                  {s.copied}
                </>
              ) : (
                <>
                  <Copy size={12} />
                  {s.copy_mcp_config}
                </>
              )}
            </button>
          </div>

          <label className="flex items-start gap-2 cursor-pointer pt-2 border-t border-border/20">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)}
              className="mt-0.5"
            />
            <span className="typo-caption text-foreground">{s.created_acknowledge}</span>
          </label>
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border/30">
          <button
            type="button"
            onClick={onClose}
            disabled={!acknowledged}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-interactive bg-primary text-primary-foreground typo-caption font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
          >
            {s.created_done}
          </button>
        </div>
      </div>
    </div>
  );
}
