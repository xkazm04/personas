/**
 * PendingAuthModal — surfaces an MCP tool call's just-in-time OAuth consent
 * URL so the user can grant access and retry the call.
 *
 * **How this is triggered**: any Tauri command that invokes
 * `engine::mcp_tools::execute_tool` (directly or via a capability adapter)
 * may return `AppError::AuthorizationRequired { credential_id, tool_name,
 * authorize_url }` when the MCP gateway responds with the
 * `authorization_required` sentinel (JSON-RPC code -32001 OR top-level
 * `kind == "authorization_required"`). Callers should catch that specific
 * `kind` and render this modal with the parsed `details` payload.
 *
 * The modal is intentionally dumb: it does not know which tool to retry on
 * its own. After the user grants consent, callers are responsible for
 * re-invoking the original tool call. This keeps the modal reusable across
 * every command that can surface `AuthorizationRequired`.
 *
 * Added 2026-04-08 as part of the LangSmith/Arcade MCP gateway pattern
 * (finding #2 from the /research run on the same date).
 */
import { useCallback, useState } from 'react';
import { ExternalLink, ShieldCheck, Loader2 } from 'lucide-react';
import { open as openExternal } from '@tauri-apps/plugin-shell';
import { BaseModal } from '@/lib/ui/BaseModal';
import { Button } from '@/features/shared/components/buttons';
import { CARD_PADDING, SECTION_GAP } from '@/lib/utils/designTokens';
import { useTranslation } from '@/i18n/useTranslation';

export interface PendingAuthDetails {
  credential_id: string;
  tool_name: string;
  authorize_url: string;
}

interface PendingAuthModalProps {
  /** Details payload from `AppError.details` when kind === 'authorization_required'. */
  details: PendingAuthDetails;
  /** Called when the user closes the modal without completing auth. */
  onDismiss: () => void;
  /**
   * Called when the user clicks "I've authorized — retry". The caller should
   * re-invoke the original tool call. The modal will close itself after the
   * handler resolves successfully; if it rejects, the modal stays open so the
   * user can try again.
   */
  onRetry: () => Promise<void>;
}

export function PendingAuthModal({ details, onDismiss, onRetry }: PendingAuthModalProps) {
  const { t } = useTranslation();
  const [urlOpened, setUrlOpened] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);

  const handleOpenUrl = useCallback(async () => {
    try {
      await openExternal(details.authorize_url);
      setUrlOpened(true);
      setRetryError(null);
    } catch (e) {
      setRetryError(`Failed to open authorization URL: ${String(e)}`);
    }
  }, [details.authorize_url]);

  const handleRetry = useCallback(async () => {
    setIsRetrying(true);
    setRetryError(null);
    try {
      await onRetry();
      // Success: close the modal.
      onDismiss();
    } catch (e) {
      // Preserve modal state so the user can click retry again after, e.g.,
      // completing the consent grant if they hadn't yet.
      setRetryError(
        e instanceof Error ? e.message : typeof e === 'string' ? e : t.vault.pending_auth.retry_failed,
      );
    } finally {
      setIsRetrying(false);
    }
  }, [onRetry, onDismiss]);

  return (
    <BaseModal
      isOpen
      onClose={onDismiss}
      titleId="pending-auth-modal-title"
      size="sm"
      portal
      panelClassName="bg-background border border-primary/15 rounded-2xl shadow-elevation-4 overflow-hidden"
    >
      <div className={CARD_PADDING.standard}>
        <div className={SECTION_GAP.within}>
          <div className="flex items-start gap-3">
            <div className="shrink-0 w-10 h-10 rounded-interactive bg-amber-500/15 text-amber-400 flex items-center justify-center">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div className="flex-1 min-w-0">
              <h2
                id="pending-auth-modal-title"
                className="typo-heading text-primary text-[14px] [text-shadow:_0_0_10px_color-mix(in_oklab,var(--primary)_35%,transparent)]"
              >
                Authorization required
              </h2>
              <p className="typo-body text-foreground mt-1">
                The tool{' '}
                <span className="font-mono text-[12px]">{details.tool_name}</span> needs fresh
                OAuth consent before it can be invoked.
              </p>
            </div>
          </div>

          <div className="rounded-interactive border border-primary/10 bg-background/50 p-3">
            <p className="typo-caption text-foreground mb-2 uppercase tracking-wider">
              Authorization URL
            </p>
            <p className="typo-body text-foreground break-all font-mono text-[11px]">
              {details.authorize_url}
            </p>
          </div>

          <ol className="typo-body text-foreground space-y-1 list-decimal pl-4">
            <li>
              Click <span className="font-semibold">Open authorization URL</span> to grant consent
              in your browser.
            </li>
            <li>Complete the consent flow for the requested scopes.</li>
            <li>
              Return here and click{' '}
              <span className="font-semibold">I&apos;ve authorized — retry</span>.
            </li>
          </ol>

          {retryError && (
            <div className="rounded-interactive border border-red-500/30 bg-red-500/10 p-3">
              <p className="typo-body text-foreground">{retryError}</p>
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-2">
            <Button variant="ghost" size="sm" onClick={onDismiss} disabled={isRetrying}>
              Cancel
            </Button>
            <Button
              variant="secondary"
              size="sm"
              icon={<ExternalLink className="w-3.5 h-3.5" />}
              onClick={handleOpenUrl}
              disabled={isRetrying}
            >
              {urlOpened ? t.vault.pending_auth.reopen_url : t.vault.pending_auth.open_auth_url}
            </Button>
            <Button
              variant="primary"
              size="sm"
              icon={isRetrying ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : undefined}
              onClick={handleRetry}
              disabled={!urlOpened || isRetrying}
              disabledReason={!urlOpened ? t.vault.pending_auth.open_first : undefined}
            >
              {isRetrying ? t.vault.pending_auth.retrying : t.vault.pending_auth.retry_authorized}
            </Button>
          </div>
        </div>
      </div>
    </BaseModal>
  );
}

/**
 * Narrow a thrown error into a {@link PendingAuthDetails} payload if and only
 * if it matches the `AppError::AuthorizationRequired` serialization shape:
 * `{ error, kind: "authorization_required", details: { credential_id,
 * tool_name, authorize_url } }`.
 *
 * Returns `null` for anything else so callers can keep their normal error
 * handling for every other error kind.
 */
export function extractPendingAuthDetails(err: unknown): PendingAuthDetails | null {
  if (!err || typeof err !== 'object') return null;
  const obj = err as Record<string, unknown>;
  if (obj.kind !== 'authorization_required') return null;
  const details = obj.details;
  if (!details || typeof details !== 'object') return null;
  const d = details as Record<string, unknown>;
  if (
    typeof d.credential_id !== 'string' ||
    typeof d.tool_name !== 'string' ||
    typeof d.authorize_url !== 'string'
  ) {
    return null;
  }
  return {
    credential_id: d.credential_id,
    tool_name: d.tool_name,
    authorize_url: d.authorize_url,
  };
}
