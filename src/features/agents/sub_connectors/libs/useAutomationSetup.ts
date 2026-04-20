import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { errMsg } from '@/stores/storeTypes';
import { useVaultStore } from "@/stores/vaultStore";
import { useAgentStore } from '@/stores/agentStore';
import { useAutomationDesign } from '@/hooks/design/core/useAutomationDesign';
import type { AutomationPlatform, AutomationFallbackMode } from '@/lib/bindings/PersonaAutomation';
import type { CredentialMetadata } from '@/lib/types/types';
import { githubListRepos, githubCheckPermissions, zapierListZaps } from '@/api/agents/automations';
import { silentCatchNull } from "@/lib/silentCatch";
import type { GitHubRepo, GitHubPermissions, DeployAutomationResult, ZapierZap } from '@/api/agents/automations';
import { parseDesignContext } from '@/features/shared/components/use-cases/UseCasesList';
import type { DesignUseCase } from '@/lib/types/frontendTypes';

export type ModalPhase = 'idle' | 'analyzing' | 'preview' | 'deploying' | 'success' | 'error';

/** Inclusive bounds for the user-editable `timeoutSecs` field before deploy. */
export const TIMEOUT_SECS_MIN = 1;
export const TIMEOUT_SECS_MAX = 3600; // one hour — anything longer pins backend resources
export const TIMEOUT_SECS_DEFAULT = 30;

/** Clamp an arbitrary numeric input into [`TIMEOUT_SECS_MIN`, `TIMEOUT_SECS_MAX`]. */
export function clampTimeoutSecs(value: number): number {
  if (!Number.isFinite(value)) return TIMEOUT_SECS_DEFAULT;
  const rounded = Math.floor(value);
  if (rounded < TIMEOUT_SECS_MIN) return TIMEOUT_SECS_MIN;
  if (rounded > TIMEOUT_SECS_MAX) return TIMEOUT_SECS_MAX;
  return rounded;
}

export const PLATFORM_TO_SERVICE_TYPE: Record<AutomationPlatform, string | null> = {
  n8n: 'n8n',
  zapier: 'zapier',
  github_actions: 'github_actions',
  custom: null,
};

export const FALLBACK_OPTIONS: Array<{ value: AutomationFallbackMode; label: string; description: string }> = [
  { value: 'connector', label: 'Fall back to agent\'s connectors', description: 'Agent uses its direct connectors if webhook fails' },
  { value: 'fail', label: 'Fail the step', description: 'Report error and stop this tool call' },
  { value: 'skip', label: 'Skip and continue', description: 'Ignore the failure and move on' },
];

export const STAGE_DEFS = [
  { label: 'Connecting', description: 'Establishing connection to AI' },
  { label: 'Analyzing requirements', description: 'Understanding what you need' },
  { label: 'Designing automation', description: 'Choosing platform and configuration' },
  { label: 'Generating workflow', description: 'Building deployable workflow definition' },
] as const;

export function deriveStageIndex(lines: string[]): number {
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i]!.toLowerCase();
    if (l.includes('design complete') || l.includes('designed successfully')) return 4;
    if (l.includes('designing automation') || l.includes('researching')) return 3;
    if (l.includes('analyzing automation') || l.includes('analyzing requirement')) return 2;
    if (l.includes('connected')) return 1;
  }
  return 0;
}

export function useAutomationSetup(personaId: string, editAutomationId?: string | null) {
  const design = useAutomationDesign();
  const automations = useVaultStore((s) => s.automations);
  const editAutomation = editAutomationId
    ? automations.find((a) => a.id === editAutomationId) ?? null
    : null;
  const [description, setDescription] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [name, setName] = useState('');
  const [platform, setPlatform] = useState<AutomationPlatform>('n8n');
  const [inputSchema, setInputSchema] = useState('');
  const [timeoutSecs, setTimeoutSecs] = useState(30);
  const [fallbackMode, setFallbackMode] = useState<AutomationFallbackMode>('connector');
  const [platformCredentialId, setPlatformCredentialId] = useState<string | null>(null);
  const [useCaseId, setUseCaseId] = useState<string | null>(null);
  const [githubRepos, setGithubRepos] = useState<GitHubRepo[]>([]);
  const [githubPerms, setGithubPerms] = useState<GitHubPermissions | null>(null);
  const [githubRepo, setGithubRepo] = useState<string | null>(null);
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [zapierZaps, setZapierZaps] = useState<ZapierZap[]>([]);
  const [loadingZaps, setLoadingZaps] = useState(false);
  const [localPhase, setLocalPhase] = useState<'deploying' | 'success' | null>(null);
  const [deployResult, setDeployResult] = useState<DeployAutomationResult | null>(null);
  const [deployError, setDeployError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);

  const personas = useAgentStore((s) => s.personas);
  const availableUseCases = useMemo<DesignUseCase[]>(() => {
    const persona = personas.find((p) => p.id === personaId);
    if (!persona) return [];
    const ucs = parseDesignContext(persona.design_context).useCases ?? [];
    return ucs.filter((uc) => uc.enabled !== false);
  }, [personas, personaId]);

  const credentials = useVaultStore((s) => s.credentials);
  const connectorDefinitions = useVaultStore((s) => s.connectorDefinitions);
  const deployAutomation = useVaultStore((s) => s.deployAutomation);
  const fetchAutomations = useVaultStore((s) => s.fetchAutomations);

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

  useEffect(() => {
    if (editAutomation) {
      setPlatform(editAutomation.platform);
      setName(editAutomation.name);
      setDescription(editAutomation.description);
      setFallbackMode(editAutomation.fallbackMode);
      setTimeoutSecs(Math.round(editAutomation.timeoutMs / 1000));
      if (editAutomation.inputSchema) setInputSchema(editAutomation.inputSchema);
      if (editAutomation.platformCredentialId) setPlatformCredentialId(editAutomation.platformCredentialId);
      setUseCaseId(editAutomation.useCaseId ?? null);
    }
  }, [editAutomation]);

  useEffect(() => {
    if (platformCredentials.length > 0 && !platformCredentialId) {
      setPlatformCredentialId(platformCredentials[0]!.id);
    } else if (platformCredentials.length === 0) {
      setPlatformCredentialId(null);
    }
  }, [platformCredentials, platformCredentialId]);

  useEffect(() => {
    if (platform !== 'github_actions' || !platformCredentialId) {
      setGithubRepos([]); setGithubPerms(null); setGithubRepo(null); return;
    }
    setLoadingRepos(true);
    Promise.all([
      githubListRepos(platformCredentialId).catch(silentCatchNull("useAutomationSetup:githubListRepos")) as Promise<GitHubRepo[] | null>,
      githubCheckPermissions(platformCredentialId).catch(silentCatchNull("useAutomationSetup:githubCheckPermissions")),
    ]).then(([repos, perms]) => { setGithubRepos(repos ?? []); setGithubPerms(perms); setLoadingRepos(false); });
  }, [platform, platformCredentialId]);

  useEffect(() => {
    if (platform !== 'zapier' || !platformCredentialId) { setZapierZaps([]); return; }
    setLoadingZaps(true);
    zapierListZaps(platformCredentialId)
      .then((zaps) => { setZapierZaps(zaps); setLoadingZaps(false); })
      .catch(() => { setZapierZaps([]); setLoadingZaps(false); });
  }, [platform, platformCredentialId]);

  useEffect(() => {
    if (design.phase !== 'analyzing') { setElapsed(0); return; }
    const id = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [design.phase]);

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
    design.start(personaId, description.trim());
  }, [description, design, personaId]);

  // Synchronous in-flight lock. A `useState`-based `localPhase` can't prevent
  // a second click that fires before React has committed the 'deploying' state
  // (classic double-click-sends-twice pattern); a ref updated inline does.
  const deployInFlightRef = useRef(false);

  const handleDeploy = async () => {
    if (!name.trim() || !platformCredentialId) return;
    if (deployInFlightRef.current) return; // guard against double-submit
    deployInFlightRef.current = true;
    // Clamp user-editable timeout at the trust boundary — the raw input can be
    // anything (999999999 overflows *1000 → ms, empty string → NaN, etc.).
    const safeTimeoutSecs = clampTimeoutSecs(timeoutSecs);
    const mergedDesign = {
      ...design.result,
      name: name.trim(),
      input_schema: inputSchema.trim() || null,
      timeout_secs: safeTimeoutSecs,
      fallback_mode: fallbackMode,
    };
    setLocalPhase('deploying'); setDeployError(null);
    try {
      const result = await deployAutomation({
        personaId, credentialId: platformCredentialId,
        designResult: mergedDesign as Record<string, unknown>,
        githubRepo: platform === 'github_actions' ? githubRepo : null,
        useCaseId,
      });
      if (result) { setDeployResult(result); setLocalPhase('success'); void fetchAutomations(personaId); }
      else { setLocalPhase(null); setDeployError('Deployment failed. Check your platform credentials and try again.'); }
    } catch (err) { setLocalPhase(null); setDeployError(errMsg(err, 'Automation deployment failed')); }
    finally { deployInFlightRef.current = false; }
  };

  /** True when timeoutSecs is outside the allowed range — UI should flag it. */
  const timeoutSecsInvalid = !Number.isFinite(timeoutSecs)
    || timeoutSecs < TIMEOUT_SECS_MIN
    || timeoutSecs > TIMEOUT_SECS_MAX;

  const handleClose = useCallback(() => {
    design.reset(); setDescription(''); setShowAdvanced(false); setName('');
    setInputSchema(''); setTimeoutSecs(30); setFallbackMode('connector');
    setPlatformCredentialId(null); setGithubRepo(null); setGithubRepos([]);
    setGithubPerms(null); setZapierZaps([]); setLocalPhase(null);
    setDeployResult(null); setDeployError(null); setUseCaseId(null);
  }, [design]);

  const stageIndex = useMemo(() => deriveStageIndex(design.outputLines), [design.outputLines]);
  const tailLines = design.outputLines.slice(-3);
  const tailRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    tailRef.current?.scrollTo({ top: tailRef.current.scrollHeight, behavior: 'smooth' });
  }, [design.outputLines.length]);

  const phase: ModalPhase = localPhase ?? (deployError ? 'error' : design.phase);
  const canDesign = description.trim().length > 0
    && (!needsCredential || hasPlatformCredential)
    && (platform !== 'github_actions' || !!githubRepo);

  // --- Focus trap & restore ---
  const dialogRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  const handleFocusTrap = useCallback((e: React.KeyboardEvent) => {
    if (e.key !== 'Tab' || !dialogRef.current) return;

    const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    if (focusable.length === 0) return;

    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;

    if (e.shiftKey) {
      if (document.activeElement === first) {
        e.preventDefault();
        last.focus();
      }
    } else {
      if (document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }, []);

  return {
    design, editAutomation, description, setDescription, showAdvanced, setShowAdvanced,
    name, setName, platform, setPlatform, inputSchema, setInputSchema,
    timeoutSecs, setTimeoutSecs, fallbackMode, setFallbackMode,
    platformCredentialId, setPlatformCredentialId,
    useCaseId, setUseCaseId, availableUseCases,
    githubRepos, githubPerms, githubRepo, setGithubRepo, loadingRepos,
    zapierZaps, loadingZaps,
    localPhase, setLocalPhase, deployResult, deployError, setDeployError,
    elapsed, platformCredentials, hasPlatformCredential, needsCredential,
    platformConnector, handleDesign, handleDeploy, handleClose,
    stageIndex, tailLines, tailRef, phase, canDesign,
    timeoutSecsInvalid,
    /** Disable the Deploy button while a deploy is in flight or inputs are invalid. */
    canDeploy: !!name.trim() && !!platformCredentialId && !timeoutSecsInvalid && localPhase !== 'deploying',
    dialogRef, returnFocusRef, handleFocusTrap,
  };
}
