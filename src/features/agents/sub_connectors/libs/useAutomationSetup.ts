import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { errMsg } from '@/stores/storeTypes';
import { useVaultStore } from "@/stores/vaultStore";
import { useAgentStore } from '@/stores/agentStore';
import { useTranslation } from '@/i18n/useTranslation';
import { useAutomationDesign } from '@/hooks/design/core/useAutomationDesign';
import type { AutomationPlatform } from '@/lib/bindings/AutomationPlatform';
import type { AutomationFallbackMode } from '@/lib/bindings/AutomationFallbackMode';
import type { CredentialMetadata } from '@/lib/types/types';
import { githubListRepos, githubCheckPermissions, zapierListZaps } from '@/api/agents/automations';
import { silentCatch, silentCatchNull } from "@/lib/silentCatch";
import type { GitHubRepo, GitHubPermissions, DeployAutomationResult, ZapierZap } from '@/api/agents/automations';
import { usePersonaCapabilities } from '@/hooks/personas/usePersonaCapabilities';

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

/** Label/description are `t.agents.connectors.<key>`; resolve at render. */
export const FALLBACK_OPTIONS = [
  { value: 'connector', labelKey: 'auto_fallback_connector_label', descriptionKey: 'auto_fallback_connector_desc' },
  { value: 'fail', labelKey: 'auto_fallback_fail_label', descriptionKey: 'auto_fallback_fail_desc' },
  { value: 'skip', labelKey: 'auto_fallback_skip_label', descriptionKey: 'auto_fallback_skip_desc' },
] as const satisfies ReadonlyArray<{ value: AutomationFallbackMode; labelKey: string; descriptionKey: string }>;

/** Label/description are `t.agents.connectors.<key>`; resolve at render. */
export const STAGE_DEFS = [
  { labelKey: 'auto_stage_connecting', descriptionKey: 'auto_stage_connecting_desc' },
  { labelKey: 'auto_stage_analyzing', descriptionKey: 'auto_stage_analyzing_desc' },
  { labelKey: 'auto_stage_designing', descriptionKey: 'auto_stage_designing_desc' },
  { labelKey: 'auto_stage_generating', descriptionKey: 'auto_stage_generating_desc' },
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

/**
 * Which platform credential the modal should hold, given what the vault
 * currently offers. Keeps a valid selection; replaces a selection that no
 * longer exists (the credential was deleted, or an edited automation points
 * at one of another platform) with the first offered; clears it when the
 * platform has none. The effect used to keep a dangling id whenever ANY
 * credential remained, so Deploy stayed enabled against a credential that
 * was gone and the banner named a different one.
 */
export function pickPlatformCredentialId(
  offered: ReadonlyArray<Pick<CredentialMetadata, 'id'>>,
  current: string | null,
): string | null {
  if (offered.length === 0) return null;
  if (current && offered.some((c) => c.id === current)) return current;
  return offered[0]!.id;
}

/**
 * The automation an Edit click targets. The persona editor lists
 * `selectedPersona.automations` (persona detail), while the vault slice's list
 * stays empty until something is deployed this session, so the persona's own
 * list is the source of truth and the vault list is only a fallback.
 */
export function findEditAutomation<T extends { id: string }>(
  personaAutomations: ReadonlyArray<T> | undefined,
  vaultAutomations: ReadonlyArray<T>,
  editAutomationId: string | null | undefined,
): T | null {
  if (!editAutomationId) return null;
  return (
    personaAutomations?.find((a) => a.id === editAutomationId) ??
    vaultAutomations.find((a) => a.id === editAutomationId) ??
    null
  );
}

export function useAutomationSetup(personaId: string, editAutomationId?: string | null) {
  const { t } = useTranslation();
  const design = useAutomationDesign();
  const automations = useVaultStore((s) => s.automations);
  const personaAutomations = useAgentStore((s) =>
    s.selectedPersona?.id === personaId ? s.selectedPersona.automations : undefined,
  );
  const editAutomation = findEditAutomation(personaAutomations, automations, editAutomationId);
  const [description, setDescription] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [name, setName] = useState('');
  const [platform, setPlatform] = useState<AutomationPlatform>('n8n');
  const [inputSchema, setInputSchema] = useState('');
  const [timeoutSecs, setTimeoutSecs] = useState(TIMEOUT_SECS_DEFAULT);
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
  // The capability picker: charters first, design-context use cases only for a
  // persona the e19 migration has not reached. `includeInactive` stays false —
  // an automation may only target a capability that is live.
  const designContext = useMemo(
    () => personas.find((p) => p.id === personaId)?.design_context ?? null,
    [personas, personaId],
  );
  const { capabilities: availableUseCases } = usePersonaCapabilities(personaId, { designContext });

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

  // Prefill ONCE per edited automation. `editAutomation` is a fresh object
  // after any persona refresh (the row comes from `selectedPersona.automations`),
  // and keying the prefill on its identity reset the user's in-progress edits.
  const prefilledIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!editAutomation) { prefilledIdRef.current = null; return; }
    if (prefilledIdRef.current === editAutomation.id) return;
    prefilledIdRef.current = editAutomation.id;
    setPlatform(editAutomation.platform);
    setName(editAutomation.name);
    setDescription(editAutomation.description);
    setFallbackMode(editAutomation.fallbackMode);
    setTimeoutSecs(Math.round(Number(editAutomation.timeoutMs) / 1000));
    if (editAutomation.inputSchema) setInputSchema(editAutomation.inputSchema);
    if (editAutomation.platformCredentialId) setPlatformCredentialId(editAutomation.platformCredentialId);
    setUseCaseId(editAutomation.useCaseId ?? null);
  }, [editAutomation]);

  useEffect(() => {
    const next = pickPlatformCredentialId(platformCredentials, platformCredentialId);
    if (next !== platformCredentialId) setPlatformCredentialId(next);
  }, [platformCredentials, platformCredentialId]);

  // A listing that FAILED is not an empty account: the flags let the trigger
  // step say so (with a retry) instead of "No repositories found. Check your
  // token permissions." for an outage. `listingAttempt` re-runs both fetches.
  const [reposFailed, setReposFailed] = useState(false);
  const [zapsFailed, setZapsFailed] = useState(false);
  const [listingAttempt, setListingAttempt] = useState(0);
  const retryListings = useCallback(() => setListingAttempt((n) => n + 1), []);

  useEffect(() => {
    setReposFailed(false);
    if (platform !== 'github_actions' || !platformCredentialId) {
      setGithubRepos([]); setGithubPerms(null); setGithubRepo(null); return;
    }
    // Guard against a stale resolve overwriting state after platform /
    // credential changes mid-flight (cancelled-flag pattern).
    let cancelled = false;
    setLoadingRepos(true);
    Promise.all([
      githubListRepos(platformCredentialId).catch(silentCatchNull("useAutomationSetup:githubListRepos")) as Promise<GitHubRepo[] | null>,
      githubCheckPermissions(platformCredentialId).catch(silentCatchNull("useAutomationSetup:githubCheckPermissions")),
    ]).then(([repos, perms]) => {
      if (cancelled) return;
      setGithubRepos(repos ?? []); setReposFailed(repos === null); setGithubPerms(perms); setLoadingRepos(false);
    });
    return () => { cancelled = true; };
  }, [platform, platformCredentialId, listingAttempt]);

  useEffect(() => {
    setZapsFailed(false);
    if (platform !== 'zapier' || !platformCredentialId) { setZapierZaps([]); return; }
    let cancelled = false;
    setLoadingZaps(true);
    zapierListZaps(platformCredentialId)
      .then((zaps) => { if (cancelled) return; setZapierZaps(zaps); setLoadingZaps(false); })
      .catch((err) => {
        silentCatch("useAutomationSetup:zapierListZaps")(err);
        if (cancelled) return;
        setZapierZaps([]); setZapsFailed(true); setLoadingZaps(false);
      });
    return () => { cancelled = true; };
  }, [platform, platformCredentialId, listingAttempt]);

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
      setTimeoutSecs(design.result.timeout_secs || TIMEOUT_SECS_DEFAULT);
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
    // The custom platform has no credential type (`PLATFORM_TO_SERVICE_TYPE.custom`
    // is null) and is saved as a draft without one; every other platform needs it.
    if (!name.trim() || (needsCredential && !platformCredentialId)) return;
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
        personaId, credentialId: needsCredential ? platformCredentialId : null,
        designResult: mergedDesign as Parameters<typeof deployAutomation>[0]['designResult'],
        githubRepo: platform === 'github_actions' ? githubRepo : null,
        useCaseId,
      });
      setDeployResult(result); setLocalPhase('success'); void fetchAutomations(personaId);
    } catch (err) {
      // The store rethrows the backend error, so the banner names the cause.
      setLocalPhase(null); setDeployError(errMsg(err, t.agents.connectors.auto_error_deploy_generic)); }
    finally { deployInFlightRef.current = false; }
  };

  /** True when timeoutSecs is outside the allowed range — UI should flag it. */
  const timeoutSecsInvalid = !Number.isFinite(timeoutSecs)
    || timeoutSecs < TIMEOUT_SECS_MIN
    || timeoutSecs > TIMEOUT_SECS_MAX;

  const handleClose = useCallback(() => {
    design.reset(); setDescription(''); setShowAdvanced(false); setName('');
    setInputSchema(''); setTimeoutSecs(TIMEOUT_SECS_DEFAULT); setFallbackMode('connector');
    setPlatformCredentialId(null); setGithubRepo(null); setGithubRepos([]);
    setGithubPerms(null); setZapierZaps([]); setLocalPhase(null);
    setDeployResult(null); setDeployError(null); setUseCaseId(null);
    setReposFailed(false); setZapsFailed(false);
    prefilledIdRef.current = null;
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
    useCaseId, setUseCaseId, availableUseCases,
    githubRepos, githubPerms, githubRepo, setGithubRepo, loadingRepos,
    zapierZaps, loadingZaps, reposFailed, zapsFailed, retryListings,
    localPhase, setLocalPhase, deployResult, deployError, setDeployError,
    elapsed, platformCredentials, hasPlatformCredential, needsCredential,
    platformConnector, handleDesign, handleDeploy, handleClose,
    stageIndex, tailLines, tailRef, phase, canDesign,
    timeoutSecsInvalid,
    /** Disable the Deploy button while a deploy is in flight or inputs are invalid. */
    canDeploy: !!name.trim() && (!needsCredential || !!platformCredentialId) && !timeoutSecsInvalid && localPhase !== 'deploying',
  };
}
