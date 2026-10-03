import { useState, type ReactNode } from 'react';
import { Globe, Key, Unplug } from 'lucide-react';

import { registerClaudeDesktopMcp, unregisterClaudeDesktopMcp, type HealthCheckItem } from '@/api/system/system';
import { Dot, KitButton, Stack } from '@/features/shared/components/kit';
import type { InstallState } from '@/hooks/utility/data/useAutoInstaller';
import { useTranslation } from '@/i18n/useTranslation';
import { errMsg } from '@/stores/storeTypes';

import { InstallButton } from './InstallButton';

/**
 * Everything layer 2 can DO about a check, in one place (kit batch home-3).
 *
 * The behaviours are carried over one for one from the old `SectionCard`: the `useAutoInstaller`
 * flows for `node` (:105-112) and `claude_cli` (:113-120), the Ollama key popup (:121-132), the
 * LiteLLM proxy popup (:133-144), the Claude Desktop MCP register / unregister toggle (:145-150,
 * :207-252) and the Google sign-in (:156-173). What changed is where they live: they used to sit
 * under every check's detail sentence in a 280px card, which is why that card's height was its
 * text's height. Now they are the second layer's payload, and every one of the three prototypes
 * reaches them through this one component.
 *
 * `compact` is the row-cell form: the one press, nothing that could decide a row's height.
 */
export interface HealthActionDeps {
  /** This check's section could not be reached: nothing here can work, so nothing is offered. */
  unavailable: boolean;
  nodeState: InstallState;
  claudeState: InstallState;
  install: (target: 'node' | 'claude_cli' | 'all') => void;
  authLoading: boolean;
  authError: string | null;
  onSignIn: () => void;
  onShowOllama: () => void;
  onShowLiteLLM: () => void;
  /** A registration changed what the check would report, so its section re-runs. */
  onMcpDone: () => void;
}

/** The control for one check, or null when the check has nothing for the operator to press. */
export function HealthAction({ item, deps, compact }: {
  item: HealthCheckItem;
  deps: HealthActionDeps;
  compact?: boolean;
}): ReactNode {
  const { t } = useTranslation();
  if (deps.unavailable) return null;

  switch (item.id) {
    case 'node':
      return item.installable
        ? <InstallButton checkId="node" status={item.status} installState={deps.nodeState} onInstall={() => deps.install('node')} compact={compact} />
        : null;
    case 'claude_cli':
      return item.installable
        ? <InstallButton checkId="claude_cli" status={item.status} installState={deps.claudeState} onInstall={() => deps.install('claude_cli')} compact={compact} />
        : null;
    case 'ollama_api_key':
      return (
        <KitButton onClick={deps.onShowOllama} icon={<Key />} stopPropagation>
          {item.status === 'ok' ? t.overview.section_card.edit_key : t.overview.section_card.configure}
        </KitButton>
      );
    case 'litellm_proxy':
      return (
        <KitButton onClick={deps.onShowLiteLLM} icon={<Key />} stopPropagation>
          {item.status === 'ok' ? t.overview.section_card.edit_config : t.overview.section_card.configure}
        </KitButton>
      );
    case 'claude_desktop_mcp':
      return <McpAction connected={item.status === 'ok'} onDone={deps.onMcpDone} compact={compact} />;
    case 'google_auth':
      return item.status === 'inactive' ? <SignInAction deps={deps} compact={compact} /> : null;
    default:
      return null;
  }
}

/** True when `HealthAction` would render something: the surfaces draw the Action column from it. */
export function hasAction(item: HealthCheckItem, unavailable: boolean): boolean {
  if (unavailable) return false;
  if (item.id === 'node' || item.id === 'claude_cli') return item.installable && item.status !== 'ok';
  if (item.id === 'google_auth') return item.status === 'inactive';
  return item.id === 'ollama_api_key' || item.id === 'litellm_proxy' || item.id === 'claude_desktop_mcp';
}

function SignInAction({ deps, compact }: { deps: HealthActionDeps; compact?: boolean }) {
  const { t } = useTranslation();
  const button = (
    <KitButton
      tone="primary"
      onClick={deps.onSignIn}
      loading={deps.authLoading}
      icon={<Globe />}
      stopPropagation
    >
      {deps.authLoading ? t.overview.section_card.signing_in : t.overview.section_card.sign_in_google}
    </KitButton>
  );
  if (compact || !deps.authError) return button;
  return (
    <Stack gap="s">
      {button}
      <span className="flex items-center gap-2">
        <Dot tone="error" glyph="solid" />
        <span className="typo-caption">{deps.authError}</span>
      </span>
    </Stack>
  );
}

function McpAction({ connected, onDone, compact }: { connected: boolean; onDone: () => void; compact?: boolean }) {
  const { t } = useTranslation();
  const [result, setResult] = useState<string | null>(null);
  // A real spinner on the control the user just pressed: the doctrine's action side, where
  // `feedback/LoadingSpinner` is banned and the shared Button's own spinner is required.
  const [busy, setBusy] = useState(false);

  const toggle = async () => {
    setResult(null);
    setBusy(true);
    try {
      setResult(connected ? await unregisterClaudeDesktopMcp() : await registerClaudeDesktopMcp());
      onDone();
    } catch (e) {
      setResult(errMsg(e, 'MCP registration failed'));
    } finally {
      setBusy(false);
    }
  };

  const button = (
    <KitButton onClick={toggle} loading={busy} icon={<Unplug />} stopPropagation>
      {busy ? t.overview.section_card.working : connected ? t.overview.section_card.disconnect : t.overview.section_card.connect_claude}
    </KitButton>
  );
  if (compact || !result) return button;
  return (
    <Stack gap="s">
      {button}
      <span className="typo-caption">{result}</span>
    </Stack>
  );
}
