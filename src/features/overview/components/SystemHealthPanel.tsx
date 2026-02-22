import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import {
  ArrowRight,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Loader2,
  RefreshCw,
  Monitor,
  Cloud,
  User,
  Info,
  Chrome,
  Download,
  Cpu,
  Key,
  ChevronDown,
  ChevronRight,
  Trash2,
  FileWarning,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { systemHealthCheck, getCrashLogs, clearCrashLogs } from '@/api/tauriApi';
import type { HealthCheckSection, HealthCheckItem, CrashLogEntry } from '@/api/tauriApi';
import { useAuthStore } from '@/stores/authStore';
import { useAutoInstaller, type InstallState } from '@/hooks/utility/useAutoInstaller';
import { ExternalLink } from 'lucide-react';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/ContentLayout';
import { ConfigurationPopup, type ConfigField } from '@/features/agents/components/onboarding/ConfigurationPopup';

// ── Constants ──────────────────────────────────────────────────────────────────

const SECTION_ICONS: Record<string, LucideIcon> = {
  local: Monitor,
  agents: Cpu,
  cloud: Cloud,
  account: User,
};

const SECTION_STYLES: Record<string, { badge: string; icon: string }> = {
  local: { badge: 'bg-violet-500/10', icon: 'text-violet-300' },
  agents: { badge: 'bg-emerald-500/10', icon: 'text-emerald-300' },
  cloud: { badge: 'bg-sky-500/10', icon: 'text-sky-300' },
  account: { badge: 'bg-amber-500/10', icon: 'text-amber-300' },
};

const DEFAULT_SECTION_STYLE = { badge: 'bg-violet-500/10', icon: 'text-violet-300' };

const LOADING_PHASES = [
  'Detecting local dependencies\u2026',
  'Checking agent configuration\u2026',
  'Checking cloud deployment status\u2026',
  'Verifying account connectivity\u2026',
];

// ── Helper Components ──────────────────────────────────────────────────────────

function getStatusIcon(status: string) {
  if (status === 'ok') return <CheckCircle2 className="w-4 h-4 text-emerald-400" />;
  if (status === 'warn') return <AlertTriangle className="w-4 h-4 text-amber-400" />;
  if (status === 'info' || status === 'inactive') return <Info className="w-4 h-4 text-muted-foreground" />;
  return <XCircle className="w-4 h-4 text-red-400" />;
}

function SectionStatusDot({ items }: { items: HealthCheckItem[] }) {
  const hasError = items.some((i) => i.status === 'error');
  const hasWarn = items.some((i) => i.status === 'warn');
  const allInactive = items.every((i) => i.status === 'inactive' || i.status === 'info');

  let dotColor = 'bg-emerald-400';
  if (hasError) dotColor = 'bg-red-400';
  else if (hasWarn) dotColor = 'bg-amber-400';
  else if (allInactive) dotColor = 'bg-zinc-500';

  return (
    <span className={`w-2 h-2 rounded-full ${dotColor}`} />
  );
}

function InstallButton({
  checkId,
  status,
  installState,
  onInstall,
}: {
  checkId: 'node' | 'claude_cli';
  status: string;
  installState: InstallState;
  onInstall: () => void;
}) {
  if (status === 'ok') return null;

  const label = checkId === 'node' ? 'Install Node.js' : 'Install Claude CLI';

  if (installState.phase === 'downloading' || installState.phase === 'installing') {
    return (
      <div className="mt-2 space-y-1.5">
        <div className="flex items-center gap-2">
          <Loader2 className="w-3 h-3 animate-spin text-violet-400" />
          <span className="text-sm text-violet-300">
            {installState.phase === 'downloading' ? 'Downloading...' : 'Installing...'}
          </span>
        </div>
        <div className="w-full h-1 bg-primary/10 rounded-full overflow-hidden">
          <div
            className="h-full bg-violet-500 rounded-full transition-all duration-300"
            style={{ width: `${installState.progressPct}%` }}
          />
        </div>
        {installState.outputLines.length > 0 && (
          <p className="text-sm text-muted-foreground/80 truncate">
            {installState.outputLines[installState.outputLines.length - 1]}
          </p>
        )}
      </div>
    );
  }

  if (installState.phase === 'completed') {
    return (
      <div className="mt-2 flex items-center gap-1.5 text-sm text-emerald-400">
        <CheckCircle2 className="w-3 h-3" />
        Installed successfully
      </div>
    );
  }

  if (installState.phase === 'failed') {
    return (
      <div className="mt-2 space-y-1.5">
        <div className="flex items-center gap-1.5 text-sm text-red-400">
          <XCircle className="w-3 h-3" />
          {installState.error || 'Installation failed'}
        </div>
        {installState.manualCommand && (
          <div className="bg-primary/5 rounded-md px-2 py-1.5">
            <p className="text-sm text-muted-foreground/80 mb-1">Try running manually:</p>
            <code className="text-sm text-foreground/80 font-mono select-all">
              {installState.manualCommand}
            </code>
          </div>
        )}
        <button
          onClick={onInstall}
          className="inline-flex items-center gap-1.5 px-2 py-1 text-sm font-medium rounded-md border border-primary/20 text-foreground/90 hover:bg-secondary/60 transition-colors"
        >
          Retry
          <RefreshCw className="w-3 h-3" />
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={onInstall}
      className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 text-sm font-medium rounded-md bg-violet-500/10 text-violet-300 border border-violet-500/20 hover:bg-violet-500/20 transition-colors"
    >
      <Download className="w-3 h-3" />
      {label}
    </button>
  );
}

// ── Popup field configs ──────────────────────────────────────────────────────

const OLLAMA_FIELDS: ConfigField[] = [
  { key: 'ollama_api_key', label: 'API Key', type: 'password', placeholder: 'Paste your key from ollama.com/settings', autoFocus: true },
];

const OLLAMA_FOOTER = (
  <>
    Sign up free at{' '}
    <a
      href="https://ollama.com"
      target="_blank"
      rel="noopener noreferrer"
      className="text-emerald-400/70 hover:text-emerald-400 inline-flex items-center gap-0.5"
    >
      ollama.com <ExternalLink className="w-2.5 h-2.5" />
    </a>
    , then copy your API key from Settings. This key is stored locally and shared across all agents.
  </>
);

const LITELLM_FIELDS: ConfigField[] = [
  { key: 'litellm_base_url', label: 'Proxy Base URL', type: 'text', placeholder: 'http://localhost:4000', autoFocus: true },
  { key: 'litellm_master_key', label: 'Master Key', type: 'password', placeholder: 'sk-...' },
];

// ── Crash Logs Section ───────────────────────────────────────────────────────

function CrashLogsSection() {
  const [expanded, setExpanded] = useState(false);
  const [backendLogs, setBackendLogs] = useState<CrashLogEntry[]>([]);
  const [frontendLogs, setFrontendLogs] = useState<Array<{ timestamp: string; component: string; message: string; stack?: string }>>([]);
  const [selectedLog, setSelectedLog] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);

  const loadLogs = useCallback(() => {
    getCrashLogs()
      .then(setBackendLogs)
      .catch(() => setBackendLogs([]));
    try {
      const raw = localStorage.getItem('__personas_frontend_crashes');
      if (raw) setFrontendLogs(JSON.parse(raw));
      else setFrontendLogs([]);
    } catch {
      setFrontendLogs([]);
    }
  }, []);

  useEffect(() => {
    if (expanded) loadLogs();
  }, [expanded, loadLogs]);

  const totalCount = backendLogs.length + frontendLogs.length;

  const handleClear = async () => {
    setClearing(true);
    try {
      await clearCrashLogs();
      localStorage.removeItem('__personas_frontend_crashes');
      setBackendLogs([]);
      setFrontendLogs([]);
      setSelectedLog(null);
    } catch {
      // ignore
    } finally {
      setClearing(false);
    }
  };

  return (
    <div className="rounded-xl border border-primary/10 bg-secondary/20 overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2.5 px-4 py-2.5 hover:bg-secondary/30 transition-colors"
      >
        <div className="w-6 h-6 rounded-md flex items-center justify-center bg-red-500/10">
          <FileWarning className="w-3.5 h-3.5 text-red-300" />
        </div>
        <span className="text-sm font-medium text-foreground/80 uppercase tracking-wider">
          Crash Logs
        </span>
        {totalCount > 0 && (
          <span className="ml-1 px-1.5 py-0.5 text-sm font-medium rounded-full bg-red-500/15 text-red-400">
            {totalCount}
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          {totalCount > 0 && expanded && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                void handleClear();
              }}
              disabled={clearing}
              className="flex items-center gap-1 px-2 py-1 text-sm rounded-md text-red-400/60 hover:text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-40"
            >
              <Trash2 className="w-3 h-3" />
              Clear
            </button>
          )}
          {expanded ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground/80" /> : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/80" />}
        </div>
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="border-t border-primary/5 px-4 py-3 space-y-2 max-h-80 overflow-y-auto">
              {totalCount === 0 && (
                <p className="text-sm text-muted-foreground/80 py-2">No crash logs recorded.</p>
              )}

              {backendLogs.map((log) => (
                <div key={log.filename} className="rounded-lg border border-primary/10 bg-background/40 overflow-hidden">
                  <button
                    onClick={() => setSelectedLog(selectedLog === log.filename ? null : log.filename)}
                    className="w-full flex items-center gap-2 px-3 py-2 hover:bg-secondary/30 transition-colors"
                  >
                    <XCircle className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />
                    <span className="text-sm text-foreground/90 font-mono truncate">{log.filename}</span>
                    <span className="ml-auto text-sm text-red-400/60 font-medium">Rust panic</span>
                  </button>
                  {selectedLog === log.filename && (
                    <div className="border-t border-primary/5 px-3 py-2">
                      <pre className="text-sm text-muted-foreground/90 whitespace-pre-wrap break-all max-h-48 overflow-y-auto font-mono leading-relaxed">
                        {log.content}
                      </pre>
                    </div>
                  )}
                </div>
              ))}

              {frontendLogs.map((log, i) => (
                <div key={`fe-${i}`} className="rounded-lg border border-primary/10 bg-background/40 overflow-hidden">
                  <button
                    onClick={() => setSelectedLog(selectedLog === `fe-${i}` ? null : `fe-${i}`)}
                    className="w-full flex items-center gap-2 px-3 py-2 hover:bg-secondary/30 transition-colors"
                  >
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
                    <span className="text-sm text-foreground/90 truncate">{log.message}</span>
                    <span className="ml-auto text-sm text-amber-400/60 font-medium flex-shrink-0">{log.component}</span>
                  </button>
                  {selectedLog === `fe-${i}` && (
                    <div className="border-t border-primary/5 px-3 py-2 space-y-1">
                      <p className="text-sm text-muted-foreground/80">
                        {log.timestamp}
                      </p>
                      {log.stack && (
                        <pre className="text-sm text-muted-foreground/90 whitespace-pre-wrap break-all max-h-48 overflow-y-auto font-mono leading-relaxed">
                          {log.stack}
                        </pre>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Main SystemHealthPanel ─────────────────────────────────────────────────────

export function SystemHealthPanel({ onNext }: { onNext?: () => void }) {
  const [sections, setSections] = useState<HealthCheckSection[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingPhase, setLoadingPhase] = useState(0);
  const [hasIssues, setHasIssues] = useState(false);
  const [ipcError, setIpcError] = useState(false);
  const prefersReducedMotion = useReducedMotion();
  const loginWithGoogle = useAuthStore((s) => s.loginWithGoogle);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const { nodeState, claudeState, install } = useAutoInstaller();
  const [showOllamaPopup, setShowOllamaPopup] = useState(false);
  const [showLiteLLMPopup, setShowLiteLLMPopup] = useState(false);

  const runChecks = useCallback(() => {
    setLoading(true);
    setIpcError(false);
    systemHealthCheck()
      .then((report) => {
        setSections(report.sections);
        setHasIssues(!report.all_ok);
        setLoading(false);
      })
      .catch(() => {
        setIpcError(true);
        setSections([
          {
            id: 'local',
            label: 'Local Environment',
            items: [
              {
                id: 'ipc',
                label: 'Application Bridge',
                status: 'error',
                detail: 'The Tauri IPC bridge is not responding. The app may need to be rebuilt or restarted.',
                installable: false,
              },
            ],
          },
          {
            id: 'agents',
            label: 'Agents',
            items: [
              { id: 'ollama_api_key', label: 'Ollama Cloud API Key', status: 'inactive', detail: 'Cannot check \u2014 IPC unavailable', installable: false },
              { id: 'litellm_proxy', label: 'LiteLLM Proxy', status: 'inactive', detail: 'Cannot check \u2014 IPC unavailable', installable: false },
            ],
          },
          {
            id: 'cloud',
            label: 'Cloud Deployment',
            items: [
              { id: 'cloud_orchestrator', label: 'Cloud Orchestrator', status: 'info', detail: 'Cannot check \u2014 IPC unavailable', installable: false },
            ],
          },
          {
            id: 'account',
            label: 'Account',
            items: [
              { id: 'google_auth', label: 'Google Account', status: 'inactive', detail: 'Cannot check \u2014 IPC unavailable', installable: false },
            ],
          },
        ]);
        setHasIssues(true);
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    runChecks();
  }, [runChecks]);

  useEffect(() => {
    if (!loading) {
      return;
    }

    const interval = window.setInterval(() => {
      setLoadingPhase((prev) => (prev + 1) % LOADING_PHASES.length);
    }, prefersReducedMotion ? 1800 : 1200);

    return () => window.clearInterval(interval);
  }, [loading, prefersReducedMotion]);

  useEffect(() => {
    if (!loading && !ipcError) {
      runChecks();
    }
  }, [isAuthenticated]);

  useEffect(() => {
    if (nodeState.phase === 'completed' || claudeState.phase === 'completed') {
      const timer = setTimeout(() => {
        runChecks();
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [nodeState.phase, claudeState.phase, runChecks]);

  const handleSignIn = async () => {
    try {
      await loginWithGoogle();
    } catch {
      // Error handled by auth store
    }
  };

  const hasNodeIssue = sections
    .flatMap((s) => s.items)
    .some((i) => i.id === 'node' && i.status !== 'ok' && i.installable);
  const hasClaudeIssue = sections
    .flatMap((s) => s.items)
    .some((i) => i.id === 'claude_cli' && i.status !== 'ok' && i.installable);
  const anyInstalling =
    nodeState.phase === 'downloading' ||
    nodeState.phase === 'installing' ||
    claudeState.phase === 'downloading' ||
    claudeState.phase === 'installing';

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
        <div className="space-y-5">
      {loading ? (
        <div className="flex-1 min-h-0 flex flex-col gap-3">
          <div className="flex items-center gap-2 px-1 text-sm text-muted-foreground/80 min-h-6">
            <Loader2 className="w-4 h-4 animate-spin" />
            <AnimatePresence mode="wait">
              <motion.span
                key={loadingPhase}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.2 }}
              >
                {LOADING_PHASES[loadingPhase]}
              </motion.span>
            </AnimatePresence>
            <span className="ml-1 inline-flex items-center gap-1">
              {[0, 1, 2].map((dot) => (
                <motion.span
                  key={`dot-${dot}`}
                  className="w-1.5 h-1.5 rounded-full bg-primary/35"
                  animate={prefersReducedMotion ? { opacity: 0.5 } : { opacity: [0.25, 0.95, 0.25] }}
                  transition={
                    prefersReducedMotion
                      ? { duration: 0 }
                      : { duration: 1.2, repeat: Infinity, delay: dot * 0.25, ease: 'easeInOut' }
                  }
                />
              ))}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 items-stretch">
            {[0, 1, 2, 3].map((idx) => (
              <motion.div
                key={`loading-${idx}`}
                initial={{ opacity: 0.35, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.12, duration: prefersReducedMotion ? 0.2 : 0.45 }}
                className="rounded-xl border border-primary/10 bg-secondary/20 min-h-[220px] relative overflow-hidden"
              >
                <motion.div
                  className="absolute inset-y-0 -left-1/2 w-1/2 bg-gradient-to-r from-transparent via-primary/10 to-transparent"
                  animate={prefersReducedMotion ? { opacity: 0 } : { x: ['0%', '300%'] }}
                  transition={
                    prefersReducedMotion
                      ? { duration: 0 }
                      : { duration: 1.8, repeat: Infinity, ease: 'linear', delay: idx * 0.12 }
                  }
                />
                <div className="px-4 py-2.5 border-b border-primary/5">
                  <div className="h-3 w-28 rounded bg-primary/10" />
                </div>
                <div className="px-4 py-3 space-y-3">
                  <div className="h-3 w-3/4 rounded bg-primary/10" />
                  <div className="h-3 w-2/3 rounded bg-primary/10" />
                  <div className="h-3 w-4/5 rounded bg-primary/10" />
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto pr-1">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 items-stretch">
          {sections.map((section, sectionIdx) => {
            const SectionIcon = SECTION_ICONS[section.id] || Monitor;
            const sectionStyle = SECTION_STYLES[section.id] ?? DEFAULT_SECTION_STYLE;
            const isAccount = section.id === 'account';
            const authItem = isAccount ? section.items.find((i) => i.id === 'google_auth') : null;
            const showSignIn = isAccount && authItem?.status === 'inactive' && !ipcError;

            return (
              <motion.div
                key={section.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: sectionIdx * 0.1, duration: 0.25 }}
                className="rounded-xl border border-primary/10 bg-secondary/20 overflow-hidden flex flex-col min-h-[220px]"
              >
                <div className="flex items-center gap-2.5 px-4 py-2.5 border-b border-primary/5">
                  <div className={`w-6 h-6 rounded-md flex items-center justify-center ${sectionStyle.badge}`}>
                    <SectionIcon className={`w-3.5 h-3.5 ${sectionStyle.icon}`} />
                  </div>
                  <span className="text-sm font-medium text-foreground/80 uppercase tracking-wider">
                    {section.label}
                  </span>
                  <div className="ml-auto">
                    <SectionStatusDot items={section.items} />
                  </div>
                </div>

                <div className="divide-y divide-primary/5 flex-1">
                  {section.items.map((check) => (
                    <div key={check.id} className="flex items-start gap-3 px-4 py-2.5">
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
                            onClick={() => setShowOllamaPopup(true)}
                            className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 text-sm font-medium rounded-md bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 hover:bg-emerald-500/20 transition-colors"
                          >
                            <Key className="w-3 h-3" />
                            {check.status === 'ok' ? 'Edit Key' : 'Configure'}
                          </button>
                        )}
                        {check.id === 'litellm_proxy' && !ipcError && (
                          <button
                            onClick={() => setShowLiteLLMPopup(true)}
                            className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 text-sm font-medium rounded-md bg-sky-500/10 text-sky-300 border border-sky-500/20 hover:bg-sky-500/20 transition-colors"
                          >
                            <Key className="w-3 h-3" />
                            {check.status === 'ok' ? 'Edit Config' : 'Configure'}
                          </button>
                        )}
                      </div>
                    </div>
                  ))}

                  {showSignIn && (
                    <div className="px-4 py-2.5">
                      <button
                        onClick={handleSignIn}
                        className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-lg bg-amber-500/10 text-amber-300 border border-amber-500/20 hover:bg-amber-500/20 transition-colors"
                      >
                        <Chrome className="w-3.5 h-3.5" />
                        Sign in with Google
                      </button>
                    </div>
                  )}
                </div>
              </motion.div>
            );
          })}
          </div>
        </div>
      )}

      {import.meta.env.DEV && <CrashLogsSection />}

      {hasIssues && !loading && (
        <p className="text-sm text-amber-400/80">
          {ipcError
            ? 'The application bridge is not responding. Try restarting the app. You can still continue to explore the interface.'
            : 'Some checks reported issues. You can still continue, but some features may not work correctly.'}
        </p>
      )}

      <div className="flex items-center gap-3">
        {!loading && !ipcError && hasNodeIssue && hasClaudeIssue && (
          <button
            onClick={() => install('all')}
            disabled={anyInstalling}
            className="flex-1 px-4 py-2.5 text-sm font-medium rounded-xl bg-violet-500/10 text-violet-300 border border-violet-500/20 hover:bg-violet-500/20 transition-colors flex items-center justify-center gap-2 disabled:opacity-40"
          >
            <Download className="w-4 h-4" />
            Install All Dependencies
          </button>
        )}
        {onNext && (
          <button
            onClick={onNext}
            disabled={loading}
            className="flex-1 px-4 py-2.5 text-sm font-medium rounded-xl bg-violet-500/15 text-violet-300 border border-violet-500/25 hover:bg-violet-500/25 transition-colors flex items-center justify-center gap-2 disabled:opacity-40"
          >
            Continue
            <ArrowRight className="w-4 h-4" />
          </button>
        )}
      </div>

      <AnimatePresence>
        {showOllamaPopup && (
          <ConfigurationPopup
            title="Ollama Cloud API Key"
            subtitle="Optional — unlocks free cloud models (Qwen3 Coder, GLM-5, Kimi K2.5) for all agents."
            accent="emerald"
            fields={OLLAMA_FIELDS}
            saveLabel="Save Key"
            footerText={OLLAMA_FOOTER}
            onClose={() => setShowOllamaPopup(false)}
            onSaved={() => {
              setShowOllamaPopup(false);
              runChecks();
            }}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showLiteLLMPopup && (
          <ConfigurationPopup
            title="LiteLLM Proxy Configuration"
            subtitle="Optional — route agents through your LiteLLM proxy for model management and cost tracking."
            accent="sky"
            fields={LITELLM_FIELDS}
            saveLabel="Save Configuration"
            footerText="These settings are stored locally and shared across all agents configured to use the LiteLLM provider."
            onClose={() => setShowLiteLLMPopup(false)}
            onSaved={() => {
              setShowLiteLLMPopup(false);
              runChecks();
            }}
          />
        )}
      </AnimatePresence>
        </div>
      </ContentBody>
    </ContentBox>
  );
}
