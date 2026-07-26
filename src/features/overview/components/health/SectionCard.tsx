import { useState } from 'react';
import { errMsg } from '@/stores/storeTypes';
import { Globe, Key, Unplug, Wrench, type LucideIcon } from 'lucide-react';
import type { HealthCheckSection } from "@/api/system/system";
import { registerClaudeDesktopMcp, unregisterClaudeDesktopMcp } from "@/api/system/system";
import type { InstallState } from '@/hooks/utility/data/useAutoInstaller';
import { Button } from '@/features/shared/components/buttons';
import { RevealItem } from '@/features/shared/components/display/RevealItem';
import { useRevealTracker } from '@/hooks/utility/interaction/useProgressiveReveal';
import { getStatusIcon, SectionStatusDot } from './StatusIndicators';
import { InstallButton } from './InstallButton';
import { HEALTH_GHOST_BAR, HEALTH_GHOST_WIDTHS } from './healthPanelConstants';
import { useTranslation } from '@/i18n/useTranslation';

export function SectionCard({
  section,
  stubIdx: _stubIdx,
  SectionIcon,
  sectionStyle,
  loading,
  ipcError,
  nodeState,
  claudeState,
  install,
  authLoading,
  authError,
  onSignIn,
  onShowOllama,
  onShowLiteLLM,
  onMcpRegistered,
}: {
  section: HealthCheckSection;
  stubIdx: number;
  SectionIcon: LucideIcon;
  sectionStyle: { badge: string; icon: string };
  /** True while a health-check run is in flight. Only gates the item ghost —
   *  once a section has real items they stay on screen for the rest of the
   *  panel's life (docs/design/overview-loading.md law 1). */
  loading: boolean;
  ipcError: boolean;
  nodeState: InstallState;
  claudeState: InstallState;
  install: (target: 'node' | 'claude_cli' | 'all') => void;
  authLoading: boolean;
  authError: string | null;
  onSignIn: () => void;
  onShowOllama: () => void;
  onShowLiteLLM: () => void;
  onMcpRegistered?: () => void;
}) {
  const { t } = useTranslation();
  const [_mcpBusy, _setMcpBusy] = useState(false);
  // No resetKey: this card never remounts (stable `key={section.id}` in the
  // parent grid), so the tracker latches for the panel's lifetime — a re-run
  // (auth change, install completion, manual refresh) never replays the
  // entrance cascade for items already on screen.
  const enter = useRevealTracker();

  const isAccount = section.id === 'account';
  const authItem = isAccount ? section.items.find((i) => i.id === 'google_auth') : null;
  const showSignIn = isAccount && authItem?.status === 'inactive' && !ipcError;

  return (
    <div
      className="animate-fade-slide-in rounded-modal border border-primary/10 bg-secondary/20 shadow-elevation-1 hover:shadow-elevation-2 transition-all overflow-hidden flex flex-col min-h-[160px] group"
    >
      <div className="flex items-center gap-3 px-4 py-4 border-b border-primary/5 bg-background/30 group-hover:bg-background/50 transition-colors">
        <div className={`w-8 h-8 rounded-modal flex items-center justify-center ${sectionStyle.badge}`}>
          <SectionIcon className={`w-4 h-4 ${sectionStyle.icon}`} />
        </div>
        <span className="typo-label text-foreground/90">
          {section.label}
        </span>
        <div className="ml-auto">
          <SectionStatusDot items={section.items} />
        </div>
      </div>

      <div className="divide-y divide-primary/5 flex-1 bg-gradient-to-b from-transparent to-black/[0.02]">
        {section.items.length === 0 ? (
          loading && <SectionItemGhosts />
        ) : (
          section.items.map((check, index) => (
            <RevealItem
              key={check.id}
              revealId={check.id}
              order={index}
              hasEntered={enter.hasEntered}
              markEntered={enter.markEntered}
              className="flex items-start gap-3 px-4 py-3 hover:bg-primary/[0.04] transition-colors"
            >
              {getStatusIcon(check.status)}
              <div className="flex-1 min-w-0">
                <p className="typo-body text-foreground">{check.label}</p>
                {check.detail && (
                  <p className="typo-body text-foreground break-words line-clamp-2">{check.detail}</p>
                )}
                {check.remediation && (
                  <p className="typo-caption text-foreground break-words mt-1 flex items-start gap-1.5">
                    <Wrench className="w-3.5 h-3.5 mt-0.5 shrink-0 text-primary" />
                    <span>{check.remediation}</span>
                  </p>
                )}

                {check.id === 'node' && check.installable && !ipcError && (
                  <InstallButton
                    checkId="node"
                    status={check.status}
                    installState={nodeState}
                    onInstall={() => install('node')}
                  />
                )}
                {check.id === 'claude_cli' && check.installable && !ipcError && (
                  <InstallButton
                    checkId="claude_cli"
                    status={check.status}
                    installState={claudeState}
                    onInstall={() => install('claude_cli')}
                  />
                )}
                {check.id === 'ollama_api_key' && !ipcError && (
                  <Button
                    variant="accent"
                    accentColor="emerald"
                    size="xs"
                    onClick={onShowOllama}
                    icon={<Key className="w-3 h-3" />}
                    className="mt-2"
                  >
                    {check.status === 'ok' ? t.overview.section_card.edit_key : t.overview.section_card.configure}
                  </Button>
                )}
                {check.id === 'litellm_proxy' && !ipcError && (
                  <Button
                    variant="accent"
                    accentColor="sky"
                    size="xs"
                    onClick={onShowLiteLLM}
                    icon={<Key className="w-3 h-3" />}
                    className="mt-2"
                  >
                    {check.status === 'ok' ? t.overview.section_card.edit_config : t.overview.section_card.configure}
                  </Button>
                )}
                {check.id === 'claude_desktop_mcp' && !ipcError && (
                  <ClaudeDesktopMcpButton
                    isConnected={check.status === 'ok'}
                    onDone={onMcpRegistered}
                  />
                )}
              </div>
            </RevealItem>
          ))
        )}

        {showSignIn && (
          <div className="px-4 py-2.5 space-y-1.5">
            <Button
              variant="accent"
              accentColor="amber"
              size="sm"
              onClick={onSignIn}
              disabled={authLoading}
              loading={authLoading}
              icon={authLoading ? undefined : <Globe className="w-3.5 h-3.5" />}
            >
              {authLoading ? t.overview.section_card.signing_in : t.overview.section_card.sign_in_google}
            </Button>
            {authError && (
              <p className="typo-body text-red-400/80">{authError}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SectionItemGhosts — calm placeholder for a section's item region while its
// health check is in flight and nothing real has resolved yet
// (docs/design/overview-loading.md §C). Entrance is delayed ≥120ms via
// `animate-fade-in`'s `fill-mode: both`, so a fast check never paints one.
// Real items replace ghosts the frame data lands (plain conditional, no
// gate) and then latch via `useRevealTracker` — a later re-run never
// re-shows this ghost because sections keep their prior items on screen.
// ---------------------------------------------------------------------------
function SectionItemGhosts() {
  return (
    <div className="py-1" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex items-start gap-3 px-4 py-3">
          <span
            className="w-4 h-4 rounded-full bg-primary/[0.06] mt-0.5 flex-shrink-0 animate-fade-in"
            style={{ animationDelay: `${120 + i * 35}ms` }}
          />
          <span
            className={`block h-3 mt-0.5 ${HEALTH_GHOST_WIDTHS[i % HEALTH_GHOST_WIDTHS.length]} ${HEALTH_GHOST_BAR} animate-fade-in`}
            style={{ animationDelay: `${120 + i * 35}ms` }}
          />
        </div>
      ))}
    </div>
  );
}

function ClaudeDesktopMcpButton({
  isConnected,
  onDone,
}: {
  isConnected: boolean;
  onDone?: () => void;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const handleToggle = async () => {
    setBusy(true);
    setResult(null);
    try {
      const msg = isConnected
        ? await unregisterClaudeDesktopMcp()
        : await registerClaudeDesktopMcp();
      setResult(msg);
      onDone?.();
    } catch (e) {
      setResult(errMsg(e, 'MCP registration failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-2 space-y-1">
      <Button
        variant="accent"
        accentColor={isConnected ? 'rose' : 'violet'}
        size="xs"
        onClick={handleToggle}
        disabled={busy}
        loading={busy}
        icon={busy ? undefined : <Unplug className="w-3 h-3" />}
      >
        {busy ? t.overview.section_card.working : isConnected ? t.overview.section_card.disconnect : t.overview.section_card.connect_claude}
      </Button>
      {result && (
        <p className="text-[11px] text-foreground">{result}</p>
      )}
    </div>
  );
}
