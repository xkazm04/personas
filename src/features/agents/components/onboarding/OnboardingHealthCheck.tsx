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
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { systemHealthCheck, getAppSetting, setAppSetting } from '@/api/tauriApi';
import type { HealthCheckSection, HealthCheckItem } from '@/api/tauriApi';
import { useAuthStore } from '@/stores/authStore';
import { useAutoInstaller, type InstallState } from '@/hooks/utility/useAutoInstaller';
import { ExternalLink } from 'lucide-react';

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
          <span className="text-[11px] text-violet-300">
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
          <p className="text-[10px] text-muted-foreground/30 truncate">
            {installState.outputLines[installState.outputLines.length - 1]}
          </p>
        )}
      </div>
    );
  }

  if (installState.phase === 'completed') {
    return (
      <div className="mt-2 flex items-center gap-1.5 text-[11px] text-emerald-400">
        <CheckCircle2 className="w-3 h-3" />
        Installed successfully
      </div>
    );
  }

  if (installState.phase === 'failed') {
    return (
      <div className="mt-2 space-y-1.5">
        <div className="flex items-center gap-1.5 text-[11px] text-red-400">
          <XCircle className="w-3 h-3" />
          {installState.error || 'Installation failed'}
        </div>
        {installState.manualCommand && (
          <div className="bg-primary/5 rounded-md px-2 py-1.5">
            <p className="text-[10px] text-muted-foreground/40 mb-1">Try running manually:</p>
            <code className="text-[10px] text-foreground/60 font-mono select-all">
              {installState.manualCommand}
            </code>
          </div>
        )}
        <button
          onClick={onInstall}
          className="inline-flex items-center gap-1.5 px-2 py-1 text-[11px] font-medium rounded-md border border-primary/20 text-foreground/70 hover:bg-secondary/60 transition-colors"
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
      className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium rounded-md bg-violet-500/10 text-violet-300 border border-violet-500/20 hover:bg-violet-500/20 transition-colors"
    >
      <Download className="w-3 h-3" />
      {label}
    </button>
  );
}

// ── Popups ──────────────────────────────────────────────────────────────────────

function OllamaApiKeyPopup({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const [apiKey, setApiKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    getAppSetting('ollama_api_key')
      .then((val) => {
        if (val) setApiKey(val);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await setAppSetting('ollama_api_key', apiKey.trim());
      onSaved();
    } catch {
      // keep popup open
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-background border border-primary/15 rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden"
      >
        <div className="px-5 py-4 border-b border-primary/10">
          <h3 className="text-sm font-semibold text-foreground/90 flex items-center gap-2">
            <Key className="w-4 h-4 text-emerald-400" />
            Ollama Cloud API Key
          </h3>
          <p className="text-xs text-muted-foreground/50 mt-1">
            Optional — unlocks free cloud models (Qwen3 Coder, GLM-5, Kimi K2.5) for all agents.
          </p>
        </div>

        <div className="px-5 py-4 space-y-3">
          <div>
            <label className="block text-xs font-medium text-foreground/60 mb-1.5">API Key</label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={loaded ? 'Paste your key from ollama.com/settings' : 'Loading\u2026'}
              disabled={!loaded}
              autoFocus
              className="w-full px-3 py-2 bg-secondary/40 border border-primary/15 rounded-lg text-sm text-foreground placeholder-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 transition-all disabled:opacity-50"
            />
          </div>
          <p className="text-[11px] text-muted-foreground/40 leading-relaxed">
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
          </p>
        </div>

        <div className="px-5 py-3 border-t border-primary/10 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs font-medium rounded-lg text-muted-foreground/60 hover:bg-secondary/60 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!apiKey.trim() || saving}
            className="px-3 py-1.5 text-xs font-medium rounded-lg bg-emerald-500/15 text-emerald-300 border border-emerald-500/25 hover:bg-emerald-500/25 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {saving ? 'Saving\u2026' : 'Save Key'}
          </button>
        </div>
      </motion.div>
    </div>
  );
}

function LiteLLMConfigPopup({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const [baseUrl, setBaseUrl] = useState('');
  const [masterKey, setMasterKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    Promise.all([
      getAppSetting('litellm_base_url'),
      getAppSetting('litellm_master_key'),
    ])
      .then(([url, key]) => {
        if (url) setBaseUrl(url);
        if (key) setMasterKey(key);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await setAppSetting('litellm_base_url', baseUrl.trim());
      await setAppSetting('litellm_master_key', masterKey.trim());
      onSaved();
    } catch {
      // keep popup open
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-background border border-primary/15 rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden"
      >
        <div className="px-5 py-4 border-b border-primary/10">
          <h3 className="text-sm font-semibold text-foreground/90 flex items-center gap-2">
            <Key className="w-4 h-4 text-sky-400" />
            LiteLLM Proxy Configuration
          </h3>
          <p className="text-xs text-muted-foreground/50 mt-1">
            Optional — route agents through your LiteLLM proxy for model management and cost tracking.
          </p>
        </div>

        <div className="px-5 py-4 space-y-3">
          <div>
            <label className="block text-xs font-medium text-foreground/60 mb-1.5">Proxy Base URL</label>
            <input
              type="text"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder={loaded ? 'http://localhost:4000' : 'Loading\u2026'}
              disabled={!loaded}
              autoFocus
              className="w-full px-3 py-2 bg-secondary/40 border border-primary/15 rounded-lg text-sm text-foreground placeholder-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-sky-500/40 transition-all disabled:opacity-50"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-foreground/60 mb-1.5">Master Key</label>
            <input
              type="password"
              value={masterKey}
              onChange={(e) => setMasterKey(e.target.value)}
              placeholder={loaded ? 'sk-...' : 'Loading\u2026'}
              disabled={!loaded}
              className="w-full px-3 py-2 bg-secondary/40 border border-primary/15 rounded-lg text-sm text-foreground placeholder-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-sky-500/40 transition-all disabled:opacity-50"
            />
          </div>
          <p className="text-[11px] text-muted-foreground/40 leading-relaxed">
            These settings are stored locally and shared across all agents configured to use the LiteLLM provider.
          </p>
        </div>

        <div className="px-5 py-3 border-t border-primary/10 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs font-medium rounded-lg text-muted-foreground/60 hover:bg-secondary/60 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!baseUrl.trim() || saving}
            className="px-3 py-1.5 text-xs font-medium rounded-lg bg-sky-500/15 text-sky-300 border border-sky-500/25 hover:bg-sky-500/25 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {saving ? 'Saving\u2026' : 'Save Configuration'}
          </button>
        </div>
      </motion.div>
    </div>
  );
}

// ── Main SystemChecksPanel ─────────────────────────────────────────────────────

export function SystemChecksPanel({ onNext }: { onNext?: () => void }) {
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
    <motion.div
      initial={{ opacity: 0, x: 40 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -40 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      className="flex flex-col gap-5 w-full max-w-6xl h-full min-h-0 px-4 sm:px-6 py-4"
    >
      <div>
        <h2 className="text-lg font-semibold text-foreground/90">System Checks</h2>
        <p className="text-xs text-muted-foreground/50 mt-1">
          Verifying your environment is ready.
        </p>
      </div>

      {loading ? (
        <div className="flex-1 min-h-0 flex flex-col gap-3">
          <div className="flex items-center gap-2 px-1 text-sm text-muted-foreground/40 min-h-6">
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
                  <span className="text-xs font-medium text-foreground/60 uppercase tracking-wider">
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
                          <p className="text-xs text-muted-foreground/40 break-words line-clamp-2">{check.detail}</p>
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
                            className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium rounded-md bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 hover:bg-emerald-500/20 transition-colors"
                          >
                            <Key className="w-3 h-3" />
                            {check.status === 'ok' ? 'Edit Key' : 'Configure'}
                          </button>
                        )}
                        {check.id === 'litellm_proxy' && !ipcError && (
                          <button
                            onClick={() => setShowLiteLLMPopup(true)}
                            className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium rounded-md bg-sky-500/10 text-sky-300 border border-sky-500/20 hover:bg-sky-500/20 transition-colors"
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
                        className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-lg bg-amber-500/10 text-amber-300 border border-amber-500/20 hover:bg-amber-500/20 transition-colors"
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

      {hasIssues && !loading && (
        <p className="text-xs text-amber-400/80">
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
          <OllamaApiKeyPopup
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
          <LiteLLMConfigPopup
            onClose={() => setShowLiteLLMPopup(false)}
            onSaved={() => {
              setShowLiteLLMPopup(false);
              runChecks();
            }}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
}
