import { useMemo, useState } from 'react';
import { LogIn, LogOut, Key, ArrowRight, Globe } from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { DEPLOYMENT_TOKENS } from '@/features/deployment/components/deploymentTokens';
import { useVaultStore } from '@/stores/vaultStore';
import { useSystemStore } from '@/stores/systemStore';
import { useCredentialNav } from '@/features/vault/shared/hooks/CredentialNavContext';
import { PipelineNotificationPrefs } from './PipelineNotificationPrefs';
import { useTranslation } from '@/i18n/useTranslation';

interface GitLabConnectionFormProps {
  isConnected: boolean;
  username: string;
  baseUrl: string;
  isConnecting: boolean;
  onConnect: (instanceUrl?: string) => void;
  onDisconnect: () => void;
}

export function GitLabConnectionForm({
  isConnected,
  username,
  baseUrl,
  isConnecting,
  onConnect,
  onDisconnect,
}: GitLabConnectionFormProps) {
  const { t, tx } = useTranslation();
  const [instanceUrl, setInstanceUrl] = useState('');
  const credentials = useVaultStore((s) => s.credentials);
  const setSidebarSection = useSystemStore((s) => s.setSidebarSection);
  const credentialNav = useCredentialNav();

  const gitlabCredential = useMemo(
    () => credentials.find((c) => c.service_type === 'gitlab'),
    [credentials],
  );

  const navigateToCatalog = () => {
    setSidebarSection('credentials');
    credentialNav.navigate('from-template');
  };

  if (isConnected) {
    return (
      <div className={DEPLOYMENT_TOKENS.panelSpacing}>
        <div className={`p-4 ${DEPLOYMENT_TOKENS.cardRadius} ${DEPLOYMENT_TOKENS.connectedBg} border ${DEPLOYMENT_TOKENS.connectedBorder}`}>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-card bg-emerald-500/15 border border-emerald-500/25 flex items-center justify-center">
              <span className="text-lg font-bold text-emerald-400">
                {username.charAt(0).toUpperCase()}
              </span>
            </div>
            <div>
              <p className="text-sm font-medium text-foreground/90">{tx(t.gitlab.connected_as, { username })}</p>
              <p className="text-sm text-muted-foreground/70">{baseUrl.replace(/^https?:\/\//, '')}</p>
            </div>
          </div>
        </div>

        <PipelineNotificationPrefs />

        <button
          onClick={onDisconnect}
          className="flex items-center gap-2 px-4 py-2 text-sm rounded-modal border border-red-500/20 bg-red-500/5 text-red-400 hover:bg-red-500/10 transition-colors"
        >
          <LogOut className="w-4 h-4" />
          {t.gitlab.disconnect}
        </button>
      </div>
    );
  }

  return (
    <div className={DEPLOYMENT_TOKENS.panelSpacing}>
      {/* Vault credential status */}
      <div className={`p-4 ${DEPLOYMENT_TOKENS.cardRadius} bg-secondary/30 border border-primary/10`}>
        <h3 className={`text-sm font-medium text-foreground/90 ${DEPLOYMENT_TOKENS.sectionHeadingGap}`}>
          {t.gitlab.gitlab_credential}
        </h3>

        {gitlabCredential ? (
          <>
            <div className="flex items-center gap-2 text-sm text-emerald-400">
              <Key className="w-4 h-4" />
              <span>
                {tx(t.gitlab.using_credential, { name: gitlabCredential.name })}
              </span>
            </div>

            <div className="mt-3">
              <label htmlFor="gitlab-instance-url" className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground/70 mb-1.5">
                <Globe className="w-3.5 h-3.5" />
                {t.gitlab.instance_url}
              </label>
              <input
                id="gitlab-instance-url"
                type="url"
                value={instanceUrl}
                onChange={(e) => setInstanceUrl(e.target.value)}
                placeholder={t.gitlab.instance_url_placeholder}
                className="w-full px-3 py-2 text-sm rounded-card bg-secondary/50 border border-primary/10 text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-orange-500/40 transition-colors"
              />
              <p className="mt-1 text-xs text-muted-foreground/50">
                {t.gitlab.instance_url_help}
              </p>
            </div>

            <button
              onClick={() => onConnect(instanceUrl || undefined)}
              disabled={isConnecting}
              className="mt-3 flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-modal bg-orange-500/15 border border-orange-500/25 text-orange-400 hover:bg-orange-500/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {isConnecting ? (
                <span role="status" aria-live="polite" className="inline-flex items-center gap-2">
                  <LoadingSpinner />
                  <span className="sr-only">Connecting to GitLab...</span>
                </span>
              ) : (
                <LogIn className="w-4 h-4" />
              )}
              {isConnecting ? t.gitlab.connecting : t.gitlab.connect_to_gitlab}
            </button>
          </>
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground/70">
              {t.gitlab.no_pat_found}
            </p>
            <button
              onClick={navigateToCatalog}
              className="flex items-center gap-2 px-3 py-1.5 text-sm rounded-card bg-orange-500/10 border border-orange-500/20 text-orange-400 hover:bg-orange-500/15 transition-colors"
            >
              <Key className="w-3.5 h-3.5" />
              {t.gitlab.add_gitlab_credential}
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
