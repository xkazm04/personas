import { useState, useEffect } from 'react';
import { AnimatePresence } from 'framer-motion';
import { useMotion } from '@/hooks/utility/interaction/useMotion';
import { RefreshCw, Monitor } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { useAutoInstaller } from '@/hooks/utility/data/useAutoInstaller';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { ConfigurationPopup } from '@/features/agents/components/onboarding/ConfigurationPopup';
import { usePersonaStore } from '@/stores/personaStore';

import { SECTION_ICONS, SECTION_STYLES, DEFAULT_SECTION_STYLE, SKELETON_SECTIONS } from './healthPanelConstants';
import { OLLAMA_FIELDS, OLLAMA_FOOTER, LITELLM_FIELDS } from './popupFieldConfigs';
import { CrashLogsSection } from './CrashLogsSection';
import { SkeletonCard } from './SkeletonCard';
import { SectionCard } from './SectionCard';
import { FooterActions } from './FooterActions';
import { useHealthChecks } from './useHealthChecks';

export function SystemHealthPanel({ onNext }: { onNext?: () => void }) {
  const { sections, loading, hasIssues, ipcError, runChecks } = useHealthChecks();
  const { shouldAnimate, duration } = useMotion();
  const loginWithGoogle = useAuthStore((s) => s.loginWithGoogle);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const authLoading = useAuthStore((s) => s.isLoading);
  const authError = useAuthStore((s) => s.error);
  const { nodeState, claudeState, install } = useAutoInstaller();
  const [showOllamaPopup, setShowOllamaPopup] = useState(false);
  const [showLiteLLMPopup, setShowLiteLLMPopup] = useState(false);
  const personas = usePersonaStore((s) => s.personas);
  const onboardingCompleted = usePersonaStore((s) => s.onboardingCompleted);
  const onboardingActive = usePersonaStore((s) => s.onboardingActive);
  const startOnboarding = usePersonaStore((s) => s.startOnboarding);

  useEffect(() => {
    if (!loading && !ipcError) {
      runChecks();
    }
  }, [isAuthenticated]);

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
        title="System Checks"
        subtitle="Verifying your environment is ready"
        actions={
          !loading ? (
            <button
              onClick={runChecks}
              className="p-1.5 rounded-lg text-muted-foreground/80 hover:text-muted-foreground hover:bg-secondary/50 transition-colors"
              title="Re-run checks"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
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

              if (loading && !loaded) {
                return (
                  <SkeletonCard
                    key={stub.id}
                    stub={stub}
                    stubIdx={stubIdx}
                    SectionIcon={SectionIcon}
                    sectionStyle={sectionStyle}
                    shouldAnimate={shouldAnimate}
                    duration={duration}
                  />
                );
              }

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
                />
              );
            })}
          </div>

          {import.meta.env.DEV && <CrashLogsSection />}

          {hasIssues && !loading && (
            <p className="text-sm text-amber-400/80">
              {ipcError
                ? 'The application bridge is not responding. Try restarting the app. You can still continue to explore the interface.'
                : 'Some checks reported issues. You can still continue, but some features may not work correctly.'}
            </p>
          )}

          <FooterActions
            loading={loading}
            ipcError={ipcError}
            hasNodeIssue={hasNodeIssue}
            hasClaudeIssue={hasClaudeIssue}
            anyInstalling={anyInstalling}
            hasIssues={hasIssues}
            personas={personas}
            onboardingCompleted={onboardingCompleted}
            onboardingActive={onboardingActive}
            install={install}
            startOnboarding={startOnboarding}
            onNext={onNext}
          />

          <AnimatePresence>
            {showOllamaPopup && (
              <ConfigurationPopup
                title="Ollama Cloud API Key"
                subtitle="Optional \u2014 unlocks free cloud models (Qwen3 Coder, GLM-5, Kimi K2.5) for all agents."
                accent="emerald"
                fields={OLLAMA_FIELDS}
                saveLabel="Save Key"
                footerText={OLLAMA_FOOTER}
                onClose={() => setShowOllamaPopup(false)}
                onSaved={() => { setShowOllamaPopup(false); runChecks(); }}
              />
            )}
          </AnimatePresence>

          <AnimatePresence>
            {showLiteLLMPopup && (
              <ConfigurationPopup
                title="LiteLLM Proxy Configuration"
                subtitle="Optional \u2014 route agents through your LiteLLM proxy for model management and cost tracking."
                accent="sky"
                fields={LITELLM_FIELDS}
                saveLabel="Save Configuration"
                footerText="These settings are stored locally and shared across all agents configured to use the LiteLLM provider."
                onClose={() => setShowLiteLLMPopup(false)}
                onSaved={() => { setShowLiteLLMPopup(false); runChecks(); }}
              />
            )}
          </AnimatePresence>
        </div>
      </ContentBody>
    </ContentBox>
  );
}
