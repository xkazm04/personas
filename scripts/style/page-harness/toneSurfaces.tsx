/**
 * Three real surfaces whose accent Buttons carry a tone (WP4b, `accentColor`
 * became `tone`), mounted on synthetic props so a before/after pair shows
 * only the colour change. No IPC: the tapes for these modules are empty.
 *
 *   tone/health-cards   the System Check list + detail: success, info, warning, error
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

/**
 * Was `SectionCard`, the hand-rolled health card the owner called unusable; kit batch home-3
 * replaced it with `HealthRows` (the declared-column list) plus `HealthDetail` (layer 2). The
 * module id is kept so anything pointing at it still resolves, and so do the tones it was adopted
 * for: a passing check (success), one that is not configured (info), one ageing (warning) and one
 * failing (error), each drawn as the kit's Mark rather than as a palette step.
 */
async function healthCards(): Promise<{ default: ComponentType }> {
  const { HealthRows } = await import('@/features/overview/components/health/HealthRows');
  const { HealthDetail } = await import('@/features/overview/components/health/HealthDetail');
  const { KitHost, Surface, Section } = await import('@/features/shared/components/kit');
  const deps = {
    unavailable: false,
    nodeState: IDLE,
    claudeState: IDLE,
    install: noop,
    authLoading: false,
    authError: null,
    onSignIn: noop,
    onShowOllama: noop,
    onShowLiteLLM: noop,
    onMcpDone: noop,
  };
  const item = (id: string, label: string, status: 'ok' | 'inactive' | 'warn' | 'error', detail: string | null = null, remediation?: string) =>
    ({ id, label, status, detail, installable: false, ...(remediation ? { remediation } : null) });
  const rows = [
    { sectionId: 'agents' as const, item: item('ollama_api_key', 'Ollama API key', 'ok', 'Key stored in the vault') },
    { sectionId: 'agents' as const, item: item('litellm_proxy', 'LiteLLM proxy', 'inactive', 'No proxy configured') },
    { sectionId: 'local' as const, item: item('disk', 'Disk space', 'warn', '6.2 GB free on C:', 'Free space on C:, or move the data directory.') },
    { sectionId: 'account' as const, item: item('google_auth', 'Google account', 'inactive', 'Not signed in') },
  ];
  return {
    default: function ToneHealth() {
      return (
        <KitHost compact>
          <Surface dense>
            <Section title="Checks" count={rows.length}>
              <HealthRows rows={rows} label="checks" showSection deps={deps} />
            </Section>
            <HealthDetail row={rows[2]!} deps={deps} onRecheck={noop} />
          </Surface>
        </KitHost>
      );
    },
  };
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
