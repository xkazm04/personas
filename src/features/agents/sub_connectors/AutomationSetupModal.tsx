import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  X, Zap, Sparkles, Loader2, CheckCircle2, AlertCircle,
  ChevronDown, Clock, Check, Circle, Pencil, KeyRound, ExternalLink,
  GitBranch, Rocket,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { usePersonaStore } from '@/stores/personaStore';
import { useAutomationDesign } from '@/hooks/design/useAutomationDesign';
import type { AutomationPlatform, AutomationFallbackMode } from '@/lib/bindings/PersonaAutomation';
import type { CredentialMetadata } from '@/lib/types/types';
import { githubListRepos, githubCheckPermissions } from '@/api/automations';
import type { GitHubRepo, GitHubPermissions, DeployAutomationResult } from '@/api/automations';
import { ThemedSelect } from '@/features/shared/components/ThemedSelect';
import { PLATFORM_CONFIG } from './automationTypes';

interface AutomationSetupModalProps {
  open: boolean;
  personaId: string;
  onClose: () => void;
  onComplete: () => void;
  editAutomationId?: string | null;
}

const PLATFORM_TO_SERVICE_TYPE: Record<AutomationPlatform, string | null> = {
  n8n: 'n8n',
  zapier: 'zapier',
  github_actions: 'github_actions',
  custom: null,
};

const FALLBACK_OPTIONS: Array<{ value: AutomationFallbackMode; label: string; description: string }> = [
  { value: 'connector', label: 'Fall back to agent\'s connectors', description: 'Agent uses its direct connectors if webhook fails' },
  { value: 'fail', label: 'Fail the step', description: 'Report error and stop this tool call' },
  { value: 'skip', label: 'Skip and continue', description: 'Ignore the failure and move on' },
];

const STAGE_DEFS = [
  { label: 'Connecting', description: 'Establishing connection to AI' },
  { label: 'Analyzing requirements', description: 'Understanding what you need' },
  { label: 'Designing automation', description: 'Choosing platform and configuration' },
  { label: 'Generating workflow', description: 'Building deployable workflow definition' },
] as const;

function deriveStageIndex(lines: string[]): number {
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i]!.toLowerCase();
    if (l.includes('design complete') || l.includes('designed successfully')) return 4;
    if (l.includes('designing automation') || l.includes('researching')) return 3;
    if (l.includes('analyzing automation') || l.includes('analyzing requirement')) return 2;
    if (l.includes('connected')) return 1;
  }
  return 0;
}

type ModalPhase = 'idle' | 'analyzing' | 'preview' | 'deploying' | 'success' | 'error';

export function AutomationSetupModal({
  open,
  personaId,
  onClose,
  onComplete,
  editAutomationId,
}: AutomationSetupModalProps) {
  const design = useAutomationDesign();
  const automations = usePersonaStore((s) => s.automations);
  const editAutomation = editAutomationId
    ? automations.find((a) => a.id === editAutomationId) ?? null
    : null;
  const [description, setDescription] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Editable preview fields
  const [name, setName] = useState('');
  const [platform, setPlatform] = useState<AutomationPlatform>('n8n');
  const [inputSchema, setInputSchema] = useState('');
  const [timeoutSecs, setTimeoutSecs] = useState(30);
  const [fallbackMode, setFallbackMode] = useState<AutomationFallbackMode>('connector');
  const [platformCredentialId, setPlatformCredentialId] = useState<string | null>(null);

  // GitHub-specific state
  const [githubRepos, setGithubRepos] = useState<GitHubRepo[]>([]);
  const [githubPerms, setGithubPerms] = useState<GitHubPermissions | null>(null);
  const [githubRepo, setGithubRepo] = useState<string | null>(null);
  const [loadingRepos, setLoadingRepos] = useState(false);

  // Deploy state
  const [localPhase, setLocalPhase] = useState<'deploying' | 'success' | null>(null);
  const [deployResult, setDeployResult] = useState<DeployAutomationResult | null>(null);
  const [deployError, setDeployError] = useState<string | null>(null);

  const [elapsed, setElapsed] = useState(0);

  const credentials = usePersonaStore((s) => s.credentials);
  const connectorDefinitions = usePersonaStore((s) => s.connectorDefinitions);
  const deployAutomation = usePersonaStore((s) => s.deployAutomation);
  const fetchAutomations = usePersonaStore((s) => s.fetchAutomations);

  // Credential filtering
  const platformServiceType = PLATFORM_TO_SERVICE_TYPE[platform];
  const platformCredentials = useMemo(() => {
    if (!platformServiceType) return [];
    return credentials.filter((c: CredentialMetadata) => c.service_type === platformServiceType);
  }, [credentials, platformServiceType]);
  const hasPlatformCredential = platformCredentials.length > 0;
  const needsCredential = platformServiceType !== null;

  const platformConnector = useMemo(() => {
    if (!platformServiceType) return null;
    return connectorDefinitions.find((c) => c.name === platformServiceType) ?? null;
  }, [connectorDefinitions, platformServiceType]);

  // Pre-populate from existing automation when editing
  useEffect(() => {
    if (editAutomation) {
      setPlatform(editAutomation.platform);
      setName(editAutomation.name);
      setDescription(editAutomation.description);
      setFallbackMode(editAutomation.fallbackMode);
      setTimeoutSecs(Math.round(editAutomation.timeoutMs / 1000));
      if (editAutomation.inputSchema) setInputSchema(editAutomation.inputSchema);
      if (editAutomation.platformCredentialId) setPlatformCredentialId(editAutomation.platformCredentialId);
    }
  }, [editAutomation]);

  // Auto-select first credential
  useEffect(() => {
    if (platformCredentials.length > 0 && !platformCredentialId) {
      setPlatformCredentialId(platformCredentials[0]!.id);
    } else if (platformCredentials.length === 0) {
      setPlatformCredentialId(null);
    }
  }, [platformCredentials, platformCredentialId]);

  // Fetch GitHub repos when platform is github_actions and credential is available
  useEffect(() => {
    if (platform !== 'github_actions' || !platformCredentialId) {
      setGithubRepos([]);
      setGithubPerms(null);
      setGithubRepo(null);
      return;
    }
    setLoadingRepos(true);
    Promise.all([
      githubListRepos(platformCredentialId).catch(() => [] as GitHubRepo[]),
      githubCheckPermissions(platformCredentialId).catch(() => null),
    ]).then(([repos, perms]) => {
      setGithubRepos(repos);
      setGithubPerms(perms);
      setLoadingRepos(false);
    });
  }, [platform, platformCredentialId]);

  // Timer for analyzing phase
  useEffect(() => {
    if (design.phase !== 'analyzing') { setElapsed(0); return; }
    const id = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [design.phase]);

  // Populate editable fields from AI result
  useEffect(() => {
    if (design.result) {
      setName(design.result.name);
      setPlatform(design.result.platform);
      setInputSchema(design.result.input_schema || '');
      setTimeoutSecs(design.result.timeout_secs || 30);
      setFallbackMode(design.result.fallback_mode || 'connector');
    }
  }, [design.result]);

  const handleDesign = useCallback(() => {
    if (!description.trim()) return;
    design.start({ personaId, description: description.trim() });
  }, [description, design, personaId]);

  const handleDeploy = async () => {
    if (!name.trim() || !platformCredentialId) return;

    const mergedDesign = {
      ...design.result,
      name: name.trim(),
      input_schema: inputSchema.trim() || null,
      timeout_secs: timeoutSecs,
      fallback_mode: fallbackMode,
    };

    setLocalPhase('deploying');
    setDeployError(null);

    try {
      const result = await deployAutomation({
        personaId,
        credentialId: platformCredentialId,
        designResult: mergedDesign as Record<string, unknown>,
        githubRepo: platform === 'github_actions' ? githubRepo : null,
      });

      if (result) {
        setDeployResult(result);
        setLocalPhase('success');
        void fetchAutomations(personaId);
      } else {
        setLocalPhase(null);
        setDeployError('Deployment failed. Check your platform credentials and try again.');
      }
    } catch (err) {
      setLocalPhase(null);
      setDeployError(String(err));
    }
  };

  const handleClose = () => {
    design.reset();
    setDescription('');
    setShowAdvanced(false);
    setName('');
    setInputSchema('');
    setTimeoutSecs(30);
    setFallbackMode('connector');
    setPlatformCredentialId(null);
    setGithubRepo(null);
    setGithubRepos([]);
    setGithubPerms(null);
    setLocalPhase(null);
    setDeployResult(null);
    setDeployError(null);
    onClose();
  };

  const stageIndex = useMemo(() => deriveStageIndex(design.outputLines), [design.outputLines]);
  const tailLines = design.outputLines.slice(-3);
  const tailRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    tailRef.current?.scrollTo({ top: tailRef.current.scrollHeight, behavior: 'smooth' });
  }, [design.outputLines.length]);

  if (!open) return null;

  // Effective phase: local overrides (deploying/success) take priority over design hook phase
  const phase: ModalPhase = localPhase ?? (deployError ? 'error' : design.phase);

  // Can the user proceed to design?
  const canDesign = description.trim().length > 0
    && (!needsCredential || hasPlatformCredential)
    && (platform !== 'github_actions' || !!githubRepo);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={handleClose} />
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="relative w-full max-w-3xl mx-4 rounded-2xl border border-border/60 bg-background shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border/60">
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-accent" />
            <h2 className="text-sm font-semibold text-foreground/90">
              {phase === 'idle' && (editAutomation ? 'Configure Automation' : 'Add Automation')}
              {phase === 'analyzing' && 'Designing Automation...'}
              {phase === 'preview' && 'Review Automation'}
              {phase === 'deploying' && 'Deploying...'}
              {phase === 'success' && 'Automation Deployed'}
              {phase === 'error' && 'Deployment Failed'}
            </h2>
          </div>
          <button onClick={handleClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-6 py-6 max-h-[75vh] overflow-y-auto">
          <AnimatePresence mode="wait">
            {/* ── Idle ─────────────────────────────────────── */}
            {phase === 'idle' && (
              <motion.div key="idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Describe what you want this automation to do. AI will design and deploy the workflow automatically.
                </p>

                <textarea
                  placeholder="e.g. Process uploaded CSV files, extract key data, and push results to Google Sheets"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={4}
                  autoFocus
                  className="w-full px-3.5 py-3 text-sm rounded-xl border border-border bg-secondary/20 text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/40 resize-none"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && canDesign) {
                      e.preventDefault();
                      handleDesign();
                    }
                  }}
                />

                {/* Platform selector */}
                <div className="flex items-center gap-3">
                  <label className="text-sm text-muted-foreground">Target platform:</label>
                  {editAutomation ? (
                    <span className={`inline-flex items-center px-2.5 py-1 text-sm font-medium rounded-lg border ${PLATFORM_CONFIG[platform]?.bg ?? ''} ${PLATFORM_CONFIG[platform]?.color ?? ''}`}>
                      {PLATFORM_CONFIG[platform]?.label ?? platform}
                    </span>
                  ) : (
                    <div className="flex items-center gap-1.5">
                      {(['n8n', 'github_actions', 'zapier', 'custom'] as AutomationPlatform[]).map((p) => (
                        <button
                          key={p}
                          onClick={() => { setPlatform(p); setGithubRepo(null); }}
                          className={`px-2.5 py-1 text-sm rounded-lg border transition-colors ${
                            platform === p
                              ? `${PLATFORM_CONFIG[p]?.bg ?? ''} ${PLATFORM_CONFIG[p]?.color ?? ''} border-current/30`
                              : 'border-border/60 text-muted-foreground/60 hover:text-muted-foreground hover:border-border'
                          }`}
                        >
                          {PLATFORM_CONFIG[p]?.label ?? p}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Credential gate */}
                {needsCredential && !hasPlatformCredential && (
                  <div className="flex items-start gap-3 p-3.5 rounded-xl bg-brand-amber/5 border border-brand-amber/15">
                    <KeyRound className="w-4 h-4 text-brand-amber/70 flex-shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground/80">
                        {PLATFORM_CONFIG[platform]?.label} credentials required
                      </p>
                      <p className="text-sm text-muted-foreground mt-0.5">
                        Add your {PLATFORM_CONFIG[platform]?.label} API key in the Vault to enable direct workflow management and deployment.
                      </p>
                      {platformConnector && (
                        <button
                          onClick={() => {
                            window.dispatchEvent(new CustomEvent('open-vault-connector', { detail: { connectorId: platformConnector.id } }));
                          }}
                          className="inline-flex items-center gap-1.5 mt-2 px-3 py-1.5 text-sm font-medium rounded-lg bg-brand-amber/15 border border-brand-amber/25 text-foreground/80 hover:bg-brand-amber/25 transition-colors"
                        >
                          <KeyRound className="w-3 h-3" />
                          Add {PLATFORM_CONFIG[platform]?.label} Credentials
                          <ExternalLink className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {/* Credential connected */}
                {needsCredential && hasPlatformCredential && (
                  <div className="flex items-center gap-2.5 p-3 rounded-xl bg-brand-emerald/5 border border-brand-emerald/15">
                    <CheckCircle2 className="w-4 h-4 text-brand-emerald/70 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-foreground/80">
                        <span className="font-medium text-brand-emerald">{PLATFORM_CONFIG[platform]?.label} connected</span>
                        {' — '}
                        <span className="text-muted-foreground">{platformCredentials[0]?.name}</span>
                      </p>
                    </div>
                    {platformCredentials.length > 1 && (
                      <ThemedSelect
                        value={platformCredentialId ?? ''}
                        onValueChange={(v) => setPlatformCredentialId(v || null)}
                        wrapperClassName="w-40"
                      >
                        {platformCredentials.map((c: CredentialMetadata) => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                      </ThemedSelect>
                    )}
                  </div>
                )}

                {/* GitHub: Repo picker */}
                {platform === 'github_actions' && hasPlatformCredential && (
                  <div className="space-y-2">
                    {/* Permissions check */}
                    {githubPerms && (!githubPerms.hasRepo || !githubPerms.hasWorkflow) && (
                      <div className="flex items-start gap-2.5 p-3 rounded-xl bg-brand-rose/5 border border-brand-rose/15">
                        <AlertCircle className="w-4 h-4 text-brand-rose/70 flex-shrink-0 mt-0.5" />
                        <div>
                          <p className="text-sm font-medium text-brand-rose/80">Missing GitHub permissions</p>
                          <p className="text-sm text-muted-foreground mt-0.5">
                            Your token needs{!githubPerms.hasRepo ? " 'repo'" : ''}{!githubPerms.hasRepo && !githubPerms.hasWorkflow ? ' and' : ''}{!githubPerms.hasWorkflow ? " 'workflow'" : ''} scope{(!githubPerms.hasRepo && !githubPerms.hasWorkflow) ? 's' : ''}.
                            Update your token at github.com/settings/tokens.
                          </p>
                        </div>
                      </div>
                    )}

                    {/* Repo selector */}
                    <div>
                      <label className="text-sm font-medium text-muted-foreground">Repository (required)</label>
                      <div className="mt-1.5">
                        {loadingRepos ? (
                          <div className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground">
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            Loading repositories...
                          </div>
                        ) : (
                          <ThemedSelect
                            filterable
                            options={githubRepos.map((r) => ({
                              value: r.fullName,
                              label: `${r.fullName}${r.private ? ' (private)' : ''}`,
                            }))}
                            value={githubRepo ?? ''}
                            onValueChange={(v) => setGithubRepo(v || null)}
                            placeholder="Select a repository..."
                          />
                        )}
                      </div>
                      {githubRepos.length === 0 && !loadingRepos && (
                        <p className="mt-1 text-sm text-muted-foreground/60">No repositories found. Check your token permissions.</p>
                      )}
                    </div>
                  </div>
                )}

                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground/60">
                    {canDesign ? 'Ctrl+Enter to submit' : ''}
                  </span>
                  <button
                    onClick={handleDesign}
                    disabled={!canDesign}
                    title={!canDesign ? 'Complete all required fields first' : undefined}
                    className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-xl bg-accent/20 border border-accent/30 text-foreground/90 hover:bg-accent/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    Design with AI
                  </button>
                </div>
              </motion.div>
            )}

            {/* ── Analyzing ────────────────────────────────── */}
            {phase === 'analyzing' && (
              <motion.div key="analyzing" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-4">
                <div className="flex items-center justify-between px-1">
                  {elapsed >= 3 ? (
                    <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                      <Clock className="w-3 h-3" />
                      <span>{elapsed}s elapsed</span>
                    </div>
                  ) : <div />}
                  <span className="text-sm text-muted-foreground">Typically 15-30 seconds</span>
                </div>

                <div className="h-2 rounded-full bg-primary/10 overflow-hidden">
                  <motion.div
                    className="h-full rounded-full bg-primary"
                    initial={{ width: '0%' }}
                    animate={{ width: `${Math.min((stageIndex / STAGE_DEFS.length) * 100, 100)}%` }}
                    transition={{ duration: 0.5, ease: 'easeOut' }}
                  />
                </div>

                <div className="space-y-1 px-1">
                  {STAGE_DEFS.map((def, i) => {
                    const status = i < stageIndex ? 'completed' : i === stageIndex ? 'active' : 'pending';
                    return (
                      <motion.div key={i} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.05 }} className="flex items-center gap-3 py-1.5">
                        <div className="w-5 h-5 flex items-center justify-center shrink-0">
                          {status === 'completed' ? (
                            <div className="w-5 h-5 rounded-full bg-brand-emerald/15 flex items-center justify-center">
                              <Check className="w-3 h-3 text-brand-emerald" />
                            </div>
                          ) : status === 'active' ? (
                            <Loader2 className="w-4 h-4 text-primary animate-spin" />
                          ) : (
                            <Circle className="w-3.5 h-3.5 text-muted-foreground/20" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <span className={`text-sm font-medium ${status === 'completed' ? 'text-muted-foreground' : status === 'active' ? 'text-foreground' : 'text-muted-foreground/60'}`}>
                            {def.label}
                          </span>
                          {status === 'active' && <span className="ml-2 text-sm text-muted-foreground">{def.description}</span>}
                        </div>
                      </motion.div>
                    );
                  })}
                </div>

                {tailLines.length > 0 && (
                  <div ref={tailRef} className="px-3 py-2 rounded-xl bg-secondary/30 border border-border/60 text-sm text-muted-foreground font-mono max-h-[4.5rem] overflow-y-auto">
                    {tailLines.map((line, i) => (
                      <div key={design.outputLines.length - tailLines.length + i}>{line}</div>
                    ))}
                  </div>
                )}

                <div className="flex justify-end">
                  <button onClick={() => design.cancel()} className="px-4 py-2 bg-secondary/60 hover:bg-secondary text-foreground/90 rounded-xl text-sm transition-colors">
                    Cancel
                  </button>
                </div>
              </motion.div>
            )}

            {/* ── Preview ──────────────────────────────────── */}
            {phase === 'preview' && design.result && (
              <motion.div key="preview" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-6">
                {/* AI reasoning */}
                {design.result.platform_reasoning && (
                  <div className="px-3.5 py-2.5 rounded-xl bg-accent/5 border border-accent/15">
                    <p className="text-sm text-foreground/80">
                      <span className="font-medium text-accent">AI recommendation:</span>{' '}
                      {design.result.platform_reasoning}
                    </p>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-6">
                  {/* Left column */}
                  <div className="space-y-4">
                    <div>
                      <label className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Name</label>
                      <input
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        className="w-full mt-1.5 px-3 py-2 text-sm rounded-lg border border-border bg-secondary/20 text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
                      />
                    </div>

                    {/* Platform — locked badge, no switcher */}
                    <div>
                      <label className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Platform</label>
                      <div className="mt-1.5">
                        <span className={`inline-flex items-center px-2.5 py-1 text-sm font-medium rounded-lg border ${PLATFORM_CONFIG[platform]?.bg ?? ''} ${PLATFORM_CONFIG[platform]?.color ?? ''}`}>
                          {PLATFORM_CONFIG[platform]?.label ?? platform}
                        </span>
                      </div>
                    </div>

                    {/* Platform-specific info */}
                    {platform === 'n8n' && (
                      <div className="px-3 py-2.5 rounded-lg bg-brand-amber/5 border border-brand-amber/15">
                        <p className="text-sm text-foreground/80">
                          <Rocket className="w-3.5 h-3.5 inline mr-1 text-brand-amber" />
                          Workflow will be created and activated on your n8n instance automatically.
                        </p>
                      </div>
                    )}

                    {platform === 'github_actions' && githubRepo && (
                      <div className="px-3 py-2.5 rounded-lg bg-primary/5 border border-primary/15">
                        <p className="text-sm text-foreground/80">
                          <GitBranch className="w-3.5 h-3.5 inline mr-1 text-primary" />
                          Repository dispatch configured for <span className="font-medium">{githubRepo}</span>
                        </p>
                        {design.result.workflow_definition && !!(design.result.workflow_definition as Record<string, unknown>).event_type && (
                          <p className="text-sm text-muted-foreground mt-1">
                            Event type: <code className="px-1 py-0.5 rounded bg-secondary/40 text-sm">{String((design.result.workflow_definition as Record<string, unknown>).event_type)}</code>
                          </p>
                        )}
                      </div>
                    )}

                    {platform === 'zapier' && (
                      <div className="px-3 py-2.5 rounded-lg bg-brand-amber/5 border border-brand-amber/15">
                        <p className="text-sm text-foreground/80">
                          <Zap className="w-3.5 h-3.5 inline mr-1 text-brand-amber" />
                          Catch hook will be validated and connected.
                        </p>
                      </div>
                    )}

                    {platform === 'custom' && (
                      <div className="px-3 py-2.5 rounded-lg bg-secondary/20 border border-border/40">
                        <p className="text-sm text-muted-foreground">Manual setup required. Automation will be saved as draft.</p>
                      </div>
                    )}

                    {/* Credential display */}
                    <div>
                      <label className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Credential</label>
                      {hasPlatformCredential ? (
                        <div className="mt-1.5 flex items-center gap-2 px-3 py-2 rounded-lg bg-brand-emerald/5 border border-brand-emerald/15">
                          <CheckCircle2 className="w-3.5 h-3.5 text-brand-emerald/70 flex-shrink-0" />
                          <span className="text-sm text-foreground/80">{platformCredentials.find((c) => c.id === platformCredentialId)?.name ?? platformCredentials[0]?.name}</span>
                        </div>
                      ) : (
                        <p className="mt-1.5 text-sm text-muted-foreground">None selected</p>
                      )}
                    </div>
                  </div>

                  {/* Right column */}
                  <div className="space-y-4">
                    {design.result.setup_steps && design.result.setup_steps.length > 0 && (
                      <div>
                        <label className="text-sm font-medium text-muted-foreground uppercase tracking-wider">What will happen</label>
                        <div className="mt-1.5 space-y-1.5">
                          {design.result.setup_steps.map((step, i) => (
                            <div key={i} className="flex items-start gap-2.5 px-3 py-2 rounded-lg bg-secondary/20 border border-border/40">
                              <span className="flex-shrink-0 w-5 h-5 rounded-full bg-primary/15 flex items-center justify-center text-sm font-bold text-primary mt-0.5">
                                {i + 1}
                              </span>
                              <p className="text-sm text-foreground/80 leading-relaxed">{step}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {design.result.handles_connectors && design.result.handles_connectors.length > 0 && (
                      <div>
                        <label className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Replaces connectors</label>
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {design.result.handles_connectors.map((c) => (
                            <span key={c} className="px-2 py-0.5 text-sm rounded-md bg-secondary/40 border border-border/40 text-muted-foreground">
                              {c}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Advanced toggle */}
                <button
                  onClick={() => setShowAdvanced(!showAdvanced)}
                  className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
                >
                  <Pencil className="w-3.5 h-3.5" />
                  {showAdvanced ? 'Hide' : 'Show'} advanced settings
                  <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showAdvanced ? 'rotate-180' : ''}`} />
                </button>

                <AnimatePresence>
                  {showAdvanced && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.15 }}
                      className="overflow-hidden space-y-4"
                    >
                      <div>
                        <label className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Input Schema</label>
                        <textarea
                          placeholder='{ "file_url": "string" }'
                          value={inputSchema}
                          onChange={(e) => setInputSchema(e.target.value)}
                          rows={3}
                          className="w-full mt-1.5 px-3 py-2 text-sm rounded-lg border border-border bg-secondary/20 text-foreground placeholder:text-muted-foreground/50 font-mono focus:outline-none focus:ring-1 focus:ring-primary/40 resize-none"
                        />
                      </div>
                      <div>
                        <label className="text-sm font-medium text-muted-foreground uppercase tracking-wider">On failure</label>
                        <div className="mt-1.5 space-y-1.5">
                          {FALLBACK_OPTIONS.map((opt) => (
                            <label key={opt.value} className={`flex items-start gap-2.5 p-2.5 rounded-lg border cursor-pointer transition-colors ${fallbackMode === opt.value ? 'border-primary/30 bg-primary/5' : 'border-border/60 hover:border-border'}`}>
                              <input type="radio" name="fallbackMode" checked={fallbackMode === opt.value} onChange={() => setFallbackMode(opt.value)} className="mt-0.5 accent-primary" />
                              <div>
                                <p className="text-sm text-foreground/80">{opt.label}</p>
                                <p className="text-sm text-muted-foreground/60">{opt.description}</p>
                              </div>
                            </label>
                          ))}
                        </div>
                      </div>
                      <div>
                        <label className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Timeout</label>
                        <div className="flex items-center gap-2 mt-1.5">
                          <input type="number" min={1} max={300} value={timeoutSecs} onChange={(e) => setTimeoutSecs(Number(e.target.value) || 30)} className="w-20 px-3 py-2 text-sm rounded-lg border border-border bg-secondary/20 text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40" />
                          <span className="text-sm text-muted-foreground">seconds</span>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Deploy error inline */}
                {deployError && (
                  <div className="flex items-start gap-2.5 p-3 rounded-xl bg-brand-rose/5 border border-brand-rose/15">
                    <AlertCircle className="w-4 h-4 text-brand-rose/70 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-medium text-brand-rose/80">Deployment failed</p>
                      <p className="text-sm text-brand-rose/50 mt-0.5">{deployError}</p>
                    </div>
                  </div>
                )}
              </motion.div>
            )}

            {/* ── Deploying ────────────────────────────────── */}
            {phase === 'deploying' && (
              <motion.div key="deploying" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="flex flex-col items-center justify-center py-12 space-y-4">
                <div className="w-12 h-12 rounded-full bg-accent/10 border border-accent/20 flex items-center justify-center">
                  <Loader2 className="w-5 h-5 text-accent animate-spin" />
                </div>
                <div className="text-center">
                  <p className="text-sm font-medium text-foreground/90">
                    Deploying to {PLATFORM_CONFIG[platform]?.label}...
                  </p>
                  <p className="text-sm text-muted-foreground mt-1">
                    {platform === 'n8n' && 'Creating workflow and activating on your n8n instance'}
                    {platform === 'github_actions' && 'Setting up repository dispatch integration'}
                    {platform === 'zapier' && 'Validating and connecting catch hook'}
                    {platform === 'custom' && 'Saving automation configuration'}
                  </p>
                </div>
              </motion.div>
            )}

            {/* ── Success ──────────────────────────────────── */}
            {phase === 'success' && deployResult && (
              <motion.div key="success" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} className="flex flex-col items-center justify-center py-12 space-y-4">
                <div className="w-12 h-12 rounded-full bg-brand-emerald/10 border border-brand-emerald/20 flex items-center justify-center">
                  <CheckCircle2 className="w-5 h-5 text-brand-emerald" />
                </div>
                <div className="text-center max-w-md">
                  <p className="text-sm font-medium text-foreground/90">Automation deployed successfully</p>
                  <p className="text-sm text-muted-foreground mt-1">{deployResult.deploymentMessage}</p>
                </div>
                {deployResult.platformUrl && (
                  <a
                    href={deployResult.platformUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg bg-accent/15 border border-accent/25 text-foreground/80 hover:bg-accent/25 transition-colors"
                  >
                    View on {PLATFORM_CONFIG[platform]?.label}
                    <ExternalLink className="w-3 h-3" />
                  </a>
                )}
                <button
                  onClick={() => { onComplete(); handleClose(); }}
                  className="px-4 py-2 text-sm font-medium rounded-lg bg-accent/20 border border-accent/30 text-foreground/90 hover:bg-accent/30 transition-colors"
                >
                  Done
                </button>
              </motion.div>
            )}

            {/* ── Error (from design phase) ────────────────── */}
            {phase === 'error' && !deployError && (
              <motion.div key="error" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-4">
                <div className="flex items-start gap-2.5 p-3.5 rounded-xl bg-brand-rose/5 border border-brand-rose/15">
                  <AlertCircle className="w-4 h-4 text-brand-rose/70 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-brand-rose/80">Design failed</p>
                    <p className="text-sm text-brand-rose/50 mt-0.5">{design.error || 'Unknown error'}</p>
                  </div>
                </div>
                <div className="flex justify-end gap-2">
                  <button onClick={handleClose} className="px-4 py-2 text-sm rounded-lg border border-border text-muted-foreground hover:bg-secondary/50 transition-colors">
                    Close
                  </button>
                  <button onClick={() => design.reset()} className="px-4 py-2 text-sm font-medium rounded-lg bg-accent/20 border border-accent/30 text-foreground/90 hover:bg-accent/30 transition-colors">
                    Try Again
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Footer — only in preview phase */}
        {phase === 'preview' && (
          <div className="flex items-center justify-between gap-2 px-6 py-4 border-t border-border/60">
            <button
              onClick={() => { design.reset(); setDescription(''); setLocalPhase(null); setDeployError(null); }}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Start over
            </button>
            <div className="flex items-center gap-2">
              <button onClick={handleClose} className="px-4 py-2 text-sm rounded-lg border border-border text-muted-foreground hover:bg-secondary/50 transition-colors">
                Cancel
              </button>
              <button
                onClick={() => void handleDeploy()}
                disabled={!name.trim() || (!hasPlatformCredential && needsCredential)}
                className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg bg-accent/20 border border-accent/30 text-foreground/90 hover:bg-accent/30 transition-colors disabled:opacity-40"
              >
                <Rocket className="w-3.5 h-3.5" />
                Deploy & Save
              </button>
            </div>
          </div>
        )}
      </motion.div>
    </div>
  );
}
