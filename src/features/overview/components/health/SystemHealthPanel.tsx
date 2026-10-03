import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Monitor } from 'lucide-react';

import { ConfigurationPopup } from '@/features/overview/components/health/ConfigurationPopup';
import { ContentBody, ContentBox, ContentHeader } from '@/features/shared/components/layout/ContentLayout';
import { KitHost, Segmented, Surface, Toolbar } from '@/features/shared/components/kit';
import { useAutoInstaller } from '@/hooks/utility/data/useAutoInstaller';
import { useTranslation } from '@/i18n/useTranslation';
import { silentCatch } from '@/lib/silentCatch';
import { useAuthStore } from '@/stores/authStore';

import { CrashLogsSection } from './CrashLogsSection';
import { FooterActions } from './FooterActions';
import type { HealthActionDeps } from './HealthActions';
import { LogDiskUsageSection } from './LogDiskUsageSection';
import { HealthBoardA } from './prototypes/HealthBoardA';
import { HealthFusionD } from './prototypes/HealthFusionD';
import { HealthMachineE } from './prototypes/HealthMachineE';
import { HealthSpineB } from './prototypes/HealthSpineB';
import { HealthTriageC } from './prototypes/HealthTriageC';
import { LITELLM_FIELDS, OLLAMA_FIELDS, OllamaFooter } from './popupFieldConfigs';
import { useHealthVariant, type HealthVariantId } from './healthVariant';
import { useHealthSections } from './useHealthSections';

/**
 * Home > System Check: the host of the five 2-layer prototypes (kit batch home-3).
 *
 * The owner's verdict on 2026-10-03 was "design unusable and that's why hidden behind a dev flag",
 * with the brief: layer 1 is a GRAPHICAL overview of each environment, layer 2 carries the
 * metadata and the action, and the header's re-run button comes out. This file owns only what is
 * common to all three: the chrome, the install / auth / popup wiring, and the switch between them.
 *
 * **The re-run button is gone from the header.** The panel already re-runs by itself on an auth
 * change (:below), on an install completing, on a saved Ollama key, on a saved LiteLLM
 * configuration and on an MCP registration. The one manual re-run that still earns its keep is
 * per environment, in layer 2, on the thing the operator just went and fixed - `HealthDetail`'s
 * "Check again", which calls `runSection` for that section alone.
 *
 * Every region here loads on its own fetch: six section cycles in `useHealthSections`, the log
 * stats in `LogDiskUsageSection`, the crash corpora in `CrashLogsSection`. Nothing waits on
 * anything else (`docs/design/overview-loading.md` law 6, adopted 2026-10-03).
 */
// The two diagnostics this surface carries in a dev build -- the prototype switch and the crash
// corpus -- are declared ONCE here rather than decided inside a render brace, which is the form
// `App.tsx:46-50` uses and the one the census rule `inline-dev-build-gate` asks for: the set of
// things a production build hides stays enumerable from the top of the module. In prod Vite
// replaces `import.meta.env.DEV` with `false`, so both branches fold away.
const SHOW_DIAGNOSTICS = import.meta.env.DEV;

export function SystemHealthPanel({ onNext }: { onNext?: () => void }) {
  const { t } = useTranslation();
  const board = useHealthSections();
  const [variant, setVariant] = useHealthVariant();
  const loginWithGoogle = useAuthStore((s) => s.loginWithGoogle);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const authLoading = useAuthStore((s) => s.isLoading);
  const authError = useAuthStore((s) => s.error);
  const { nodeState, claudeState, install } = useAutoInstaller();
  const [showOllamaPopup, setShowOllamaPopup] = useState(false);
  const [showLiteLLMPopup, setShowLiteLLMPopup] = useState(false);
  const mountedRef = useRef(false);
  const { runAll, runSection } = board;

  // Signing in or out changes what the account and cloud checks report.
  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      return;
    }
    runAll();
  }, [isAuthenticated, runAll]);

  // An install that just finished changes what the environment check reports; the backend needs a
  // moment to see the new binary on PATH, hence the delay the old panel also used.
  useEffect(() => {
    if (nodeState.phase !== 'completed' && claudeState.phase !== 'completed') return;
    const timer = setTimeout(() => { runSection('environment'); }, 3000);
    return () => clearTimeout(timer);
  }, [nodeState.phase, claudeState.phase, runSection]);

  const handleSignIn = useCallback(async () => {
    try {
      await loginWithGoogle();
    } catch (err) {
      silentCatch('features/overview/components/health/SystemHealthPanel:signIn')(err);
    }
  }, [loginWithGoogle]);

  const deps = useMemo<HealthActionDeps>(() => ({
    unavailable: board.anyFailed,
    nodeState,
    claudeState,
    install,
    authLoading,
    authError,
    onSignIn: handleSignIn,
    onShowOllama: () => setShowOllamaPopup(true),
    onShowLiteLLM: () => setShowLiteLLMPopup(true),
    onMcpDone: () => runSection('local'),
  }), [board.anyFailed, nodeState, claudeState, install, authLoading, authError, handleSignIn, runSection]);

  const checks = board.items;
  const hasNodeIssue = checks.some((i) => i.id === 'node' && i.status !== 'ok' && i.installable);
  const hasClaudeIssue = checks.some((i) => i.id === 'claude_cli' && i.status !== 'ok' && i.installable);
  const anyInstalling = nodeState.phase === 'downloading' || nodeState.phase === 'installing'
    || claudeState.phase === 'downloading' || claudeState.phase === 'installing';

  return (
    <ContentBox>
      <ContentHeader
        icon={<Monitor className="w-5 h-5 text-primary" />}
        iconColor="cyan"
        title={t.overview.system_health.title}
        subtitle={t.overview.system_health.subtitle}
      />

      <ContentBody centered>
        {/* NOT `compact` (doctrine 6c, consequence 3). Measured the same day with
            `scripts/style/kit-type-probe/`: a compact kit host renders every row token 11.1% to
            12.5% smaller than the same token outside it - `typo-body` is 13.20px in the app and
            11.55px here, at the default appearance setting. The tier is for dense tool lists; this
            is a diagnostic page the operator reads once and acts on, and it is the surface whose
            type the owner said "does not add". Taking it off is what lets the figure's callouts be
            labels at FULL type size, which is the whole mechanism that keeps text out of the
            drawing. */}
        <KitHost testId="system-check">
          {SHOW_DIAGNOSTICS && <VariantSwitch value={variant} onChange={setVariant} />}

          {variant === 'machine' && <HealthMachineE board={board} deps={deps} />}
          {variant === 'fusion' && <HealthFusionD board={board} deps={deps} />}
          {variant === 'board' && <HealthBoardA board={board} deps={deps} />}
          {variant === 'spine' && <HealthSpineB board={board} deps={deps} />}
          {variant === 'triage' && <HealthTriageC board={board} deps={deps} />}

          <Surface>
            {/* CrashLogsSection owns its own collapsible header and its own chrome, so wrapping it
                in a kit Section would print "Crash Logs" twice. It is DEV-only and out of this
                batch's scope; recorded as the one region of this surface still not kit-composed. */}
            {SHOW_DIAGNOSTICS && <CrashLogsSection />}
            <LogDiskUsageSection />
          </Surface>

          <FooterActions
            loading={!board.settled}
            ipcError={board.anyFailed}
            hasNodeIssue={hasNodeIssue}
            hasClaudeIssue={hasClaudeIssue}
            anyInstalling={anyInstalling}
            install={install}
            onNext={onNext}
          />
        </KitHost>

        {showOllamaPopup && (
          <ConfigurationPopup
            title={t.overview.system_health.ollama_title}
            subtitle={t.overview.system_health.ollama_subtitle}
            accent="emerald"
            fields={OLLAMA_FIELDS}
            saveLabel={t.overview.system_health.save_key}
            footerText={<OllamaFooter />}
            onClose={() => setShowOllamaPopup(false)}
            onSaved={() => { setShowOllamaPopup(false); runSection('agents'); }}
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
            onSaved={() => { setShowLiteLLMPopup(false); runSection('agents'); }}
          />
        )}
      </ContentBody>
    </ContentBox>
  );
}

/**
 * The dev-only switch between the three prototypes. The page harness writes the same persisted key
 * from `?kit=<id>`, so `shoot.mjs --kit board|spine|triage` shoots whichever one it is handed.
 */
function VariantSwitch({ value, onChange }: { value: HealthVariantId; onChange: (v: HealthVariantId) => void }) {
  const { t } = useTranslation();
  const s = t.system_health;
  return (
    <Toolbar label={s.variant_label}>
      <Segmented<HealthVariantId>
        label={s.variant_label}
        value={value}
        onChange={onChange}
        options={[
          { v: 'machine', label: s.variant_machine },
          { v: 'fusion', label: s.variant_fusion },
          { v: 'board', label: s.variant_board },
          { v: 'spine', label: s.variant_spine },
          { v: 'triage', label: s.variant_triage },
        ]}
      />
    </Toolbar>
  );
}
