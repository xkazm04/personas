/**
 * One-time plaintext display for a freshly-created API key.
 *
 * The plaintext token leaves the backend exactly once; this dialog is
 * the single moment the user can see and copy it. Closing requires an
 * explicit "I have stored this" acknowledgement so the dialog isn't
 * dismissed accidentally before the user has the value.
 *
 * Because this reveal can never be repeated, the moment is given weight:
 * the panel springs in, the token field scales up behind a soft primary
 * ring, the copy control morphs into an animated checkmark, and the
 * acknowledgement shares the Done button's primary accent so the path to
 * dismissal reads as a single connected gesture. All Framer motion is
 * gated behind `prefers-reduced-motion`; CSS transitions are neutralised
 * globally by the reduced-motion rule in globals.css.
 *
 * Also surfaces the MCP-config snippet (Claude Code style) with the new
 * key pre-substituted so the user can paste it straight into their
 * config file.
 */
import { useCallback, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { copyText } from '@/hooks/utility/interaction/useCopyToClipboard';
import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';
import { Copy, Check, AlertTriangle, X } from 'lucide-react';
import type { CreateApiKeyResponse } from '@/api/auth/externalApiKeys';
import { useTranslation } from '@/i18n/useTranslation';
import { silentCatch } from '@/lib/silentCatch';


interface CreatedKeyDialogProps {
  response: CreateApiKeyResponse;
  onClose: () => void;
}

const MCP_BASE_URL = 'http://127.0.0.1:9420';

const PANEL_SPRING = { type: 'spring' as const, stiffness: 260, damping: 24 };
const FIELD_SPRING = { type: 'spring' as const, stiffness: 240, damping: 22, delay: 0.08 };
const COPY_SPRING = { type: 'spring' as const, stiffness: 500, damping: 25 };

export function CreatedKeyDialog({ response, onClose }: CreatedKeyDialogProps) {
  const { t } = useTranslation();
  const s = t.settings.api_keys;
  const reduce = useReducedMotion();

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
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 surface-blur-modal"
      initial={reduce ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2 }}
      // No dismiss-on-backdrop-click — the user must explicitly acknowledge
      // they've stored the plaintext, since this is the only time we'll
      // show it.
    >
      <motion.div
        className="bg-secondary border border-border/40 rounded-modal shadow-elevation-3 w-full max-w-lg mx-4"
        initial={reduce ? false : { opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={reduce ? { duration: 0 } : PANEL_SPRING}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/30">
          <h2 className="typo-body font-medium text-foreground inline-flex items-center gap-2">
            <Check className="w-4 h-4 text-emerald-400" />
            {s.created_dialog_title}
          </h2>
          {acknowledged && (
            <button
              type="button"
              onClick={onClose}
              className="text-foreground hover:bg-secondary/60 rounded p-1 transition-colors focus-ring"
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
            <motion.div
              className="flex gap-2"
              initial={reduce ? false : { opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={reduce ? { duration: 0 } : FIELD_SPRING}
            >
              <input
                type="text"
                value={response.plaintext_token}
                readOnly
                className="flex-1 px-3 py-2 bg-background border border-border/40 rounded-input typo-code text-foreground select-all ring-1 ring-primary/30 transition-shadow focus:outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/50"
                onFocus={(e) => e.currentTarget.select()}
              />
              <button
                type="button"
                onClick={copyKey}
                className="inline-flex items-center justify-center gap-1.5 min-w-[88px] px-3 py-2 rounded-interactive bg-primary text-primary-foreground typo-caption font-medium hover:opacity-90 transition-opacity focus-ring"
              >
                <CopyFeedback copied={keyCopied} idle={s.copy} done={s.copied} reduce={reduce} />
              </button>
            </motion.div>
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
              className="mt-1.5 inline-flex items-center gap-1.5 typo-caption text-primary hover:opacity-80 transition-opacity focus-ring"
            >
              <CopyFeedback copied={configCopied} idle={s.copy_mcp_config} done={s.copied} reduce={reduce} />
            </button>
          </div>

          <label
            className={[
              'flex items-start gap-2.5 cursor-pointer rounded-input p-2.5 border transition-colors',
              acknowledged
                ? 'bg-primary/5 border-primary/30'
                : 'border-transparent hover:bg-secondary/40',
            ].join(' ')}
          >
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)}
              className="mt-0.5 accent-primary"
            />
            <span className="typo-caption text-foreground">{s.created_acknowledge}</span>
          </label>
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border/30">
          <button
            type="button"
            onClick={onClose}
            disabled={!acknowledged}
            className={[
              'inline-flex items-center gap-1.5 px-4 py-1.5 rounded-interactive bg-primary text-primary-foreground typo-caption font-medium transition-all duration-200 focus-ring',
              acknowledged
                ? 'opacity-100 scale-100 ring-2 ring-primary/40 shadow-elevation-2'
                : 'opacity-40 scale-[0.98] cursor-not-allowed',
            ].join(' ')}
          >
            {s.created_done}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

/**
 * Copy-button content that morphs between its idle state and an animated
 * success checkmark. Shared by the hero key-copy button and the MCP config
 * copy link so both reveal feedback the same way. Motion is gated behind
 * `prefers-reduced-motion` (instant swap, no scale).
 */
function CopyFeedback({
  copied,
  idle,
  done,
  reduce,
}: {
  copied: boolean;
  idle: string;
  done: string;
  reduce: boolean;
}) {
  const Icon = copied ? Check : Copy;
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.span
        key={copied ? 'copied' : 'idle'}
        className="inline-flex items-center gap-1.5"
        initial={reduce ? false : { opacity: 0, scale: 0.6 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.6 }}
        transition={reduce ? { duration: 0 } : COPY_SPRING}
      >
        <Icon size={12} />
        {copied ? done : idle}
      </motion.span>
    </AnimatePresence>
  );
}
