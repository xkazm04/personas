import { useState } from 'react';
import { errMsg } from '@/stores/storeTypes';
import { Globe, Key, Loader2, Unplug, type LucideIcon } from 'lucide-react';
import type { HealthCheckSection } from "@/api/system/system";
import { registerClaudeDesktopMcp, unregisterClaudeDesktopMcp } from "@/api/system/system";
import type { InstallState } from '@/hooks/utility/data/useAutoInstaller';
import { Button } from '@/features/shared/components/buttons';
import { getStatusIcon, SectionStatusDot } from './StatusIndicators';
import { InstallButton } from './InstallButton';
import { useTranslation } from '@/i18n/useTranslation';

export function SectionCard({
  section,
  stubIdx: _stubIdx,
  SectionIcon,
  sectionStyle,
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

  const isAccount = section.id === 'account';
  const authItem = isAccount ? section.items.find((i) => i.id === 'google_auth') : null;
  const showSignIn = isAccount && authItem?.status === 'inactive' && !ipcError;

  return (
    <div
      className="animate-fade-slide-in rounded-xl border border-primary/10 bg-secondary/20 shadow-elevation-1 hover:shadow-elevation-2 transition-all overflow-hidden flex flex-col min-h-[160px] group"
    >
      <div className="flex items-center gap-3 px-4 py-4 border-b border-primary/5 bg-background/30 group-hover:bg-background/50 transition-colors">
        <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${sectionStyle.badge}`}>
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
          /* Loading indicator — shown while this section's health check is in-flight */
          <div className="flex-1 flex flex-col items-center justify-center gap-2.5 py-6 px-4">
            <Loader2 className={`w-5 h-5 animate-spin ${sectionStyle.icon} opacity-60`} />
            <span className="text-xs text-muted-foreground/60">{t.overview.section_card.checking.replace('{section}', section.label.toLowerCase())}</span>
          </div>
        ) : (
          section.items.map((check) => (
            <div key={check.id} className="flex items-start gap-3 px-4 py-3 hover:bg-primary/[0.04] transition-colors">
              {getStatusIcon(check.status)}
              <div className="flex-1 min-w-0">
                <p className="typo-body text-foreground/80">{check.label}</p>
                {check.detail && (
                  <p className="typo-body text-muted-foreground/80 break-words line-clamp-2">{check.detail}</p>
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
            </div>
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
        <p className="text-[11px] text-muted-foreground/70">{result}</p>
      )}
    </div>
  );
}
