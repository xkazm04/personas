import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { usePersonaStore } from '@/stores/personaStore';
import { useAutomationDesign } from '@/hooks/design/core/useAutomationDesign';
import type { AutomationPlatform, AutomationFallbackMode } from '@/lib/bindings/PersonaAutomation';
import type { CredentialMetadata } from '@/lib/types/types';
import { githubListRepos, githubCheckPermissions, zapierListZaps } from '@/api/agents/automations';
import type { GitHubRepo, GitHubPermissions, DeployAutomationResult, ZapierZap } from '@/api/agents/automations';

export type ModalPhase = 'idle' | 'analyzing' | 'preview' | 'deploying' | 'success' | 'error';

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
  const automations = usePersonaStore((s) => s.automations);
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

  const credentials = usePersonaStore((s) => s.credentials);
  const connectorDefinitions = usePersonaStore((s) => s.connectorDefinitions);
  const deployAutomation = usePersonaStore((s) => s.deployAutomation);
  const fetchAutomations = usePersonaStore((s) => s.fetchAutomations);

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
      githubListRepos(platformCredentialId).catch(() => [] as GitHubRepo[]),
      githubCheckPermissions(platformCredentialId).catch(() => null),
    ]).then(([repos, perms]) => { setGithubRepos(repos); setGithubPerms(perms); setLoadingRepos(false); });
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
    setLocalPhase('deploying'); setDeployError(null);
    try {
      const result = await deployAutomation({
        personaId, credentialId: platformCredentialId,
        designResult: mergedDesign as Record<string, unknown>,
        githubRepo: platform === 'github_actions' ? githubRepo : null,
      });
      if (result) { setDeployResult(result); setLocalPhase('success'); void fetchAutomations(personaId); }
      else { setLocalPhase(null); setDeployError('Deployment failed. Check your platform credentials and try again.'); }
    } catch (err) { setLocalPhase(null); setDeployError(String(err)); }
  };

  const handleClose = useCallback(() => {
    design.reset(); setDescription(''); setShowAdvanced(false); setName('');
    setInputSchema(''); setTimeoutSecs(30); setFallbackMode('connector');
    setPlatformCredentialId(null); setGithubRepo(null); setGithubRepos([]);
    setGithubPerms(null); setZapierZaps([]); setLocalPhase(null);
    setDeployResult(null); setDeployError(null);
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

  return {
    design, editAutomation, description, setDescription, showAdvanced, setShowAdvanced,
    name, setName, platform, setPlatform, inputSchema, setInputSchema,
    timeoutSecs, setTimeoutSecs, fallbackMode, setFallbackMode,
    platformCredentialId, setPlatformCredentialId,
    githubRepos, githubPerms, githubRepo, setGithubRepo, loadingRepos,
    zapierZaps, loadingZaps,
    localPhase, setLocalPhase, deployResult, deployError, setDeployError,
    elapsed, platformCredentials, hasPlatformCredential, needsCredential,
    platformConnector, handleDesign, handleDeploy, handleClose,
    stageIndex, tailLines, tailRef, phase, canDesign,
  };
}
