import { useState, useEffect, useRef } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { RefreshCw, Monitor } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { useAuthStore } from '@/stores/authStore';
import { useAutoInstaller } from '@/hooks/utility/data/useAutoInstaller';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { ConfigurationPopup } from '@/features/agents/components/onboarding/ConfigurationPopup';

import { SECTION_ICONS, SECTION_STYLES, DEFAULT_SECTION_STYLE, SKELETON_SECTIONS } from './healthPanelConstants';
import { OLLAMA_FIELDS, OllamaFooter, LITELLM_FIELDS } from './popupFieldConfigs';
import { CrashLogsSection } from './CrashLogsSection';
import { SectionCard } from './SectionCard';
import { FooterActions } from './FooterActions';
import { useHealthChecks } from './useHealthChecks';

export function SystemHealthPanel({ onNext }: { onNext?: () => void }) {
  const { t } = useTranslation();
  const { sections, loading, hasIssues, ipcError, runChecks } = useHealthChecks();
  const loginWithGoogle = useAuthStore((s) => s.loginWithGoogle);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const authLoading = useAuthStore((s) => s.isLoading);
  const authError = useAuthStore((s) => s.error);
  const { nodeState, claudeState, install } = useAutoInstaller();
  const [showOllamaPopup, setShowOllamaPopup] = useState(false);
  const [showLiteLLMPopup, setShowLiteLLMPopup] = useState(false);
  const mountedRef = useRef(false);

  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      return;
    }
    runChecks();
  }, [isAuthenticated, runChecks]);

  useEffect(() => {
    if (nodeState.phase === 'completed' || claudeState.phase === 'completed') {
      const timer = setTimeout(() => { runChecks(); }, 3000);
      return () => clearTimeout(timer);
    }
  }, [nodeState.phase, claudeState.phase, runChecks]);

  const handleSignIn = async () => {
    try { await loginWithGoogle(); } catch { /* error handled by auth store */ }
  };

  const hasNodeIssue = sections
    .flatMap((s) => s.items)
    .some((i) => i.id === 'node' && i.status !== 'ok' && i.installable);
  const hasClaudeIssue = sections
    .flatMap((s) => s.items)
    .some((i) => i.id === 'claude_cli' && i.status !== 'ok' && i.installable);
  const anyInstalling =
    nodeState.phase === 'downloading' || nodeState.phase === 'installing' ||
    claudeState.phase === 'downloading' || claudeState.phase === 'installing';

  const sectionMap = new Map(sections.map((s) => [s.id, s]));

  return (
    <ContentBox>
      <ContentHeader
        icon={<Monitor className="w-5 h-5 text-cyan-400" />}
        iconColor="cyan"
        title={t.overview.system_health.title}
        subtitle={t.overview.system_health.subtitle}
        actions={
          !loading ? (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={runChecks}
              icon={<RefreshCw className="w-3.5 h-3.5" />}
              className="text-foreground hover:text-muted-foreground"
              title={t.overview.system_health.re_run_checks}
            />
          ) : undefined
        }
      />

      <ContentBody centered>
        <div className="space-y-4">
          <div className="grid gap-4 items-stretch" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
            {SKELETON_SECTIONS.map((stub, stubIdx) => {
              const loaded = sectionMap.get(stub.id);
              const SectionIcon = SECTION_ICONS[stub.id] || Monitor;
              const sectionStyle = SECTION_STYLES[stub.id] ?? DEFAULT_SECTION_STYLE;

              const section = loaded ?? { id: stub.id, label: stub.label, items: [] };
              return (
                <SectionCard
                  key={section.id}
                  section={section}
                  stubIdx={stubIdx}
                  SectionIcon={SectionIcon}
                  sectionStyle={sectionStyle}
                  ipcError={ipcError}
                  nodeState={nodeState}
                  claudeState={claudeState}
                  install={install}
                  authLoading={authLoading}
                  authError={authError}
                  onSignIn={handleSignIn}
                  onShowOllama={() => setShowOllamaPopup(true)}
                  onShowLiteLLM={() => setShowLiteLLMPopup(true)}
                  onMcpRegistered={runChecks}
                />
              );
            })}
          </div>

          {import.meta.env.DEV && (
            <div className="rounded-modal border-2 border-amber-500/30 p-0.5">
              <CrashLogsSection />
            </div>
          )}

          {hasIssues && !loading && (
            <p className="typo-body text-amber-400/80">
              {ipcError
                ? t.overview.system_health.ipc_error
                : t.overview.system_health.issues_warning}
            </p>
          )}

          <FooterActions
            loading={loading}
            ipcError={ipcError}
            hasNodeIssue={hasNodeIssue}
            hasClaudeIssue={hasClaudeIssue}
            anyInstalling={anyInstalling}
            install={install}
            onNext={onNext}
          />

          {showOllamaPopup && (
              <ConfigurationPopup
                title={t.overview.system_health.ollama_title}
                subtitle={t.overview.system_health.ollama_subtitle}
                accent="emerald"
                fields={OLLAMA_FIELDS}
                saveLabel={t.overview.system_health.save_key}
                footerText={<OllamaFooter />}
                onClose={() => setShowOllamaPopup(false)}
                onSaved={() => { setShowOllamaPopup(false); runChecks(); }}
              />
            )}

          {showLiteLLMPopup && (
              <ConfigurationPopup
                title={t.overview.system_health.litellm_title}
                subtitle={t.overview.system_health.litellm_subtitle}
                accent="sky"
                fields={LITELLM_FIELDS}
                saveLabel={t.overview.system_health.save_configuration}
                footerText={t.overview.system_health.litellm_footer}
                onClose={() => setShowLiteLLMPopup(false)}
                onSaved={() => { setShowLiteLLMPopup(false); runChecks(); }}
              />
            )}
        </div>
      </ContentBody>
    </ContentBox>
  );
}
