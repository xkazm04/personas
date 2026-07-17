import { Globe, MessageSquare, Info } from 'lucide-react';
import type { AutoCredMode } from '../helpers/types';
import { useTranslation } from '@/i18n/useTranslation';

/**
 * Makes the active setup mode honest and visible. When Playwright MCP is
 * unavailable the session silently degrades to guided copy-paste; this banner
 * names that it happened, why (Playwright MCP not found), and how to enable
 * real browser automation (npx @playwright/mcp). Automation is never invisibly
 * swapped for manual instructions again.
 */
interface AutoCredModeBannerProps {
  mode: AutoCredMode;
}

export function AutoCredModeBanner({ mode }: AutoCredModeBannerProps) {
  const { t } = useTranslation();
  const ace = t.vault.auto_cred_extra;
  const isGuided = mode === 'guided';

  return (
    <div className="space-y-2" data-testid="vault-autocred-mode-banner" data-mode={mode}>
      {/* Active-mode chip */}
      <div className="flex items-center gap-2">
        <span
          className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-input typo-caption font-medium border ${
            isGuided
              ? 'bg-violet-500/15 text-violet-300 border-violet-500/25'
              : 'bg-cyan-500/15 text-cyan-300 border-cyan-500/25'
          }`}
        >
          {isGuided ? <MessageSquare className="w-3 h-3" /> : <Globe className="w-3 h-3" />}
          {isGuided ? ace.mode_active_guided : ace.mode_active_automated}
        </span>
      </div>

      {/* Fallback explanation — only when we degraded to guided */}
      {isGuided && (
        <div className="flex items-start gap-2.5 p-3 rounded-card border border-amber-500/20 bg-amber-500/5">
          <Info className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
          <div className="typo-body text-foreground space-y-1">
            <p>
              <span className="font-medium text-amber-400/90">{ace.guided_fallback_title}</span>{' '}
              {ace.guided_fallback_body}
            </p>
            <p className="typo-code font-mono text-foreground">{ace.guided_fallback_hint}</p>
          </div>
        </div>
      )}
    </div>
  );
}
