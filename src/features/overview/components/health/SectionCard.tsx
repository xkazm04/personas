import { motion } from 'framer-motion';
import { Loader2, Chrome, Key } from 'lucide-react';
import type { HealthCheckSection } from '@/api/tauriApi';
import type { InstallState } from '@/hooks/utility/data/useAutoInstaller';
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
                <button
                  onClick={onShowOllama}
                  className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 text-sm font-medium rounded-xl bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 hover:bg-emerald-500/20 transition-colors"
                >
                  <Key className="w-3 h-3" />
                  {check.status === 'ok' ? 'Edit Key' : 'Configure'}
                </button>
              )}
              {check.id === 'litellm_proxy' && !ipcError && (
                <button
                  onClick={onShowLiteLLM}
                  className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 text-sm font-medium rounded-xl bg-sky-500/10 text-sky-300 border border-sky-500/20 hover:bg-sky-500/20 transition-colors"
                >
                  <Key className="w-3 h-3" />
                  {check.status === 'ok' ? 'Edit Config' : 'Configure'}
                </button>
              )}
            </div>
          </div>
        ))}

        {showSignIn && (
          <div className="px-4 py-2.5 space-y-1.5">
            <button
              onClick={onSignIn}
              disabled={authLoading}
              className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-xl bg-amber-500/10 text-amber-300 border border-amber-500/20 hover:bg-amber-500/20 transition-colors disabled:opacity-50"
            >
              {authLoading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Chrome className="w-3.5 h-3.5" />
              )}
              {authLoading ? 'Signing in...' : 'Sign in with Google'}
            </button>
            {authError && (
              <p className="text-sm text-red-400/80">{authError}</p>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
}
