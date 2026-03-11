import { motion } from 'framer-motion';
import { Chrome, Key } from 'lucide-react';
import type { HealthCheckSection } from '@/api/tauriApi';
import type { InstallState } from '@/hooks/utility/data/useAutoInstaller';
import { Button } from '@/features/shared/components/buttons';
import { getStatusIcon, SectionStatusDot } from './StatusIndicators';
import { InstallButton } from './InstallButton';

export function SectionCard({
  section,
  stubIdx,
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
}: {
  section: HealthCheckSection;
  stubIdx: number;
  SectionIcon: React.ElementType;
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
}) {
  const isAccount = section.id === 'account';
  const authItem = isAccount ? section.items.find((i) => i.id === 'google_auth') : null;
  const showSignIn = isAccount && authItem?.status === 'inactive' && !ipcError;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: stubIdx * 0.1, duration: 0.25 }}
      className="rounded-xl border border-primary/10 bg-secondary/20 shadow-sm hover:shadow-md transition-all overflow-hidden flex flex-col min-h-[160px] group"
    >
      <div className="flex items-center gap-3 px-4 py-4 border-b border-primary/5 bg-background/30 group-hover:bg-background/50 transition-colors">
        <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${sectionStyle.badge}`}>
          <SectionIcon className={`w-4 h-4 ${sectionStyle.icon}`} />
        </div>
        <span className="text-sm font-bold text-foreground/90 uppercase tracking-widest">
          {section.label}
        </span>
        <div className="ml-auto">
          <SectionStatusDot items={section.items} />
        </div>
      </div>

      <div className="divide-y divide-primary/5 flex-1 bg-gradient-to-b from-transparent to-black/[0.02]">
        {section.items.map((check) => (
          <div key={check.id} className="flex items-start gap-3 px-4 py-3 hover:bg-white/[0.02] transition-colors">
            {getStatusIcon(check.status)}
            <div className="flex-1 min-w-0">
              <p className="text-sm text-foreground/80">{check.label}</p>
              {check.detail && (
                <p className="text-sm text-muted-foreground/80 break-words line-clamp-2">{check.detail}</p>
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
                  {check.status === 'ok' ? 'Edit Key' : 'Configure'}
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
                  {check.status === 'ok' ? 'Edit Config' : 'Configure'}
                </Button>
              )}
            </div>
          </div>
        ))}

        {showSignIn && (
          <div className="px-4 py-2.5 space-y-1.5">
            <Button
              variant="accent"
              accentColor="amber"
              size="sm"
              onClick={onSignIn}
              disabled={authLoading}
              loading={authLoading}
              icon={authLoading ? undefined : <Chrome className="w-3.5 h-3.5" />}
            >
              {authLoading ? 'Signing in...' : 'Sign in with Google'}
            </Button>
            {authError && (
              <p className="text-sm text-red-400/80">{authError}</p>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
}
