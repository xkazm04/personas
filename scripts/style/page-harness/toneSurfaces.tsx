/**
 * Three real surfaces whose accent Buttons carry a tone (WP4b, `accentColor`
 * became `tone`), mounted on synthetic props so a before/after pair shows
 * only the colour change. No IPC: the tapes for these modules are empty.
 *
 *   tone/health-cards   SectionCard: success, info, warning, error, agent
 *   tone/n8n-footer     N8nWizardFooter at four steps: info, success, error, warning, agent
 *   tone/query-toolbar  QueryToolbar idle / saved+running: success, error, agent
 */
import type { ComponentType } from 'react';
import type { InstallState } from '@/hooks/utility/data/useAutoInstaller';
import type { HarnessModule } from './registry';

const noop = () => {};
const IDLE: InstallState = { phase: 'idle', progressPct: 0, outputLines: [], error: null, manualCommand: null };

function stack(rows: ComponentType[]): { default: ComponentType } {
  return {
    default: function ToneStack() {
      return (
        <div className="flex flex-col gap-4 p-6">
          {rows.map((Row, i) => <Row key={i} />)}
        </div>
      );
    },
  };
}

async function healthCards(): Promise<{ default: ComponentType }> {
  const { SectionCard } = await import('@/features/overview/components/health/SectionCard');
  const { Cpu, UserRound } = await import('lucide-react');
  const common = {
    stubIdx: 0,
    sectionStyle: { badge: 'bg-primary/10', icon: 'text-primary' },
    loading: false,
    ipcError: false,
    nodeState: IDLE,
    claudeState: IDLE,
    install: noop,
    authLoading: false,
    authError: null,
    onSignIn: noop,
    onShowOllama: noop,
    onShowLiteLLM: noop,
  };
  const item = (id: string, label: string, status: 'ok' | 'inactive' | 'warn', detail: string | null = null) =>
    ({ id, label, status, detail, installable: false });
  return stack([
    () => (
      <SectionCard
        {...common}
        SectionIcon={Cpu}
        section={{
          id: 'local', label: 'Local environment', items: [
            item('ollama_api_key', 'Ollama API key', 'ok', 'Key stored in the vault'),
            item('litellm_proxy', 'LiteLLM proxy', 'inactive', 'Not configured'),
            item('claude_desktop_mcp', 'Claude Desktop MCP', 'ok', 'Registered'),
          ],
        }}
      />
    ),
    () => (
      <SectionCard
        {...common}
        SectionIcon={UserRound}
        section={{
          id: 'account', label: 'Account', items: [
            item('google_auth', 'Google account', 'inactive', 'Not signed in'),
            item('claude_desktop_mcp', 'Claude Desktop MCP', 'inactive', 'Not registered'),
          ],
        }}
      />
    ),
  ]);
}

async function n8nFooter(): Promise<{ default: ComponentType }> {
  const { N8nWizardFooter } = await import('@/features/templates/sub_n8n/widgets/N8nWizardFooter');
  const base = {
    canGoBack: true, onBack: noop, onNext: noop, transforming: false, confirming: false, created: false,
    hasDraft: true, hasParseResult: true, onTest: noop, onApplyAdjustment: noop, onProcessWithMatrix: noop,
  };
  return stack([
    () => <N8nWizardFooter {...base} step="analyze" />,
    () => <N8nWizardFooter {...base} step="edit" testStatus="idle" />,
    () => <N8nWizardFooter {...base} step="edit" testStatus="failed" testError="Step 3 returned 401" />,
    () => <N8nWizardFooter {...base} step="edit" testStatus="passed" />,
    () => <N8nWizardFooter {...base} step="confirm" />,
  ]);
}

async function queryToolbar(): Promise<{ default: ComponentType }> {
  const { QueryToolbar } = await import('@/features/vault/sub_databases/tabs/QueryToolbar');
  const base = {
    selectedTitle: 'Weekly active users by plan', language: 'sql', serviceType: 'postgres',
    editorValue: 'select plan, count(*) from users group by plan', isAiRunning: false, safeMode: true,
    onSave: noop, onExecute: noop, onCancel: noop, onAiRun: noop, onToggleSafeMode: noop,
  };
  return stack([
    () => <QueryToolbar {...base} saveState="idle" executing={false} />,
    () => <QueryToolbar {...base} saveState="saved" executing />,
  ]);
}

export const TONE_MODULES: Record<string, HarnessModule> = {
  'tone/health-cards': { load: healthCards },
  'tone/n8n-footer': { load: n8nFooter },
  'tone/query-toolbar': { load: queryToolbar },
};
