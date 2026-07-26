/**
 * Structural ratchet: every `#[derive(TS)] #[ts(export)]` **struct** under
 * `src-tauri/src/` must declare `#[serde(rename_all = "camelCase")]`, so the
 * binding it generates presents camelCase to the frontend like the rest of the
 * codebase. A struct without it leaks Rust's snake_case across the IPC boundary.
 *
 * 304 structs (of 804 exported) predate the rule and are baselined below,
 * grouped by file so each shrink is reviewable in a diff. **The baseline may only
 * SHRINK.** Two assertions enforce that:
 *   1. a NEW exported struct without the rename fails the day it is written —
 *      that is the drift mechanism which produced the 304;
 *   2. a baseline entry that gained the rename (or was deleted) must be removed
 *      from the list, so the ratchet cannot silently go slack.
 *
 * Removing an entry is not free: a struct whose snake fields are READ by the
 * frontend needs its consumers migrated in the same change, which is why the
 * bulk of this list is retired in phased per-module passes rather than at once.
 * Structs held back deliberately (persisted JSON columns, TOML-deserialized
 * registries) carry an inline comment naming the reason — renaming those changes
 * an on-disk format, not just the wire.
 *
 * ENUMS ARE OUT OF SCOPE for this ratchet, on purpose. `serde(rename_all)` on an
 * enum governs *variant* casing, which is a different convention with different
 * correct answers — this codebase deliberately uses `rename_all = "lowercase"`
 * for lifecycle/status enums (see `engine/lifecycle.rs`) so their tokens match
 * the DB and the `tokenLabel()` maps. 78 of 87 exported enums currently
 * declare no rename at all; auditing those is tracked as a separate follow-up.
 *
 * Why a vitest check and not Clippy: this is a cross-attribute source pattern
 * that needs no compile, and vitest runs on every `npm run test` and in CI.
 *
 * Supersedes the dev-tools-only `dev-models-camelcase.test.ts`.
 * ADR: 2026-05-10-snake-case-binding-leak.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const REPO_ROOT = resolve(__dirname, '../../..');
const RUST_SRC = join(REPO_ROOT, 'src-tauri/src');

/**
 * Legacy exported structs shipped before the rule, keyed by file. Shrink-only —
 * never add an entry; make the new struct camelCase instead.
 */
const LEGACY_SNAKE_CASE_BASELINE: Record<string, string[]> = {
  'src-tauri/src/commands/communication/observability/metrics.rs': [
    'PersonaMonthlySpend',
  ],
  'src-tauri/src/commands/communication/observability/prompt_lab.rs': [
    'PromptAbExecResult',
  ],
  'src-tauri/src/commands/core/data_portability.rs': [
    'CompetitiveImportPreview', 'CredentialConflict', 'CredentialImportResult', 'ExportStats',
    'PortabilityImportResult',
  ],
  // not touched this pass: file had uncommitted work in another session
  'src-tauri/src/commands/core/memories.rs': [
    'ApplyMemoryReviewProposalResult', 'MemoryLifecycleResult', 'MemoryReviewDetail',
    'MemoryReviewResult',
  ],
  'src-tauri/src/commands/core/use_cases.rs': [
    'RenameEventListenersResult', 'UseCaseGenerationSettings', 'UseCaseToggleResult',
  ],
  'src-tauri/src/commands/credentials/auto_cred_browser.rs': [
    'AutoCredBrowserRequest', 'AutoCredBrowserResult', 'AutoCredField',
  ],
  // held — PersonaSetup is serialized into the personas.setup_detail JSON column — a rename changes an on-disk format, not just the wire
  'src-tauri/src/commands/design/connector_readiness.rs': [
    'PersonaSetup',
  ],
  'src-tauri/src/commands/design/reviews.rs': [
    'SeededLinkedArtifacts',
  ],
  'src-tauri/src/commands/design/team_synthesis.rs': [
    'TeamSynthesisResult',
  ],
  'src-tauri/src/commands/execution/tests.rs': [
    'DraftValidationResult', 'ToolIssue',
  ],
  'src-tauri/src/commands/fleet/types.rs': [
    'FleetHookEvent',
  ],
  'src-tauri/src/commands/infrastructure/auth.rs': [
    'AuthStateResponse', 'AuthUser',
  ],
  'src-tauri/src/commands/infrastructure/byom.rs': [
    'ProviderConnectionResult',
  ],
  'src-tauri/src/commands/infrastructure/cloud.rs': [
    'CloudConfig',
  ],
  'src-tauri/src/commands/infrastructure/kpi_sim.rs': [
    'KpiSimIngestSummary', 'KpiSimPrepared',
  ],
  'src-tauri/src/commands/infrastructure/static_scan.rs': [
    'StaticScanResult',
  ],
  // not touched this pass: file had uncommitted work in another session
  'src-tauri/src/commands/infrastructure/twin.rs': [
    'TwinRecallBundle',
  ],
  'src-tauri/src/commands/infrastructure/workspace_harvest.rs': [
    'HarvestPrepared',
  ],
  'src-tauri/src/commands/network/bundle.rs': [
    'ClipboardExportResult',
  ],
  'src-tauri/src/commands/tools/triggers.rs': [
    'CronAgent', 'CronPreview', 'DryRunChainTarget', 'DryRunMatchedSubscription',
    'DryRunResult', 'DryRunSimulatedEvent', 'RecentScheduleRun', 'TriggerChainLink',
    'TriggerCleanupResult', 'WebhookStatus',
  ],
  'src-tauri/src/db/models/audit_incident.rs': [
    'CreateAuditIncidentInput', 'IncidentFilters',
  ],
  'src-tauri/src/db/models/audit_log.rs': [
    'CredentialDependent',
  ],
  'src-tauri/src/db/models/build_session.rs': [
    'UserAnswer',
  ],
  'src-tauri/src/db/models/connector.rs': [
    'ConnectorDefinition', 'CreateConnectorDefinitionInput', 'UpdateConnectorDefinitionInput',
  ],
  'src-tauri/src/db/models/credential.rs': [
    'CreateCredentialEventInput', 'CredentialEvent', 'UpdateCredentialEventInput',
  ],
  // held — LedgerHealthEntry is persisted inside the persona_credentials.metadata ledger — a rename silently drops fields from existing rows
  'src-tauri/src/db/models/credential_ledger.rs': [
    'CredentialLedger', 'LedgerAnomalyScore', 'LedgerHealthEntry',
  ],
  'src-tauri/src/db/models/credential_recipe.rs': [
    'CredentialRecipe',
  ],
  'src-tauri/src/db/models/db_schema.rs': [
    'DbSavedQuery', 'DbSchemaTable', 'QueryResult',
  ],
  // held — ScanAgentMeta is the Deserialize target for the embedded scan_agents.toml registry — a rename panics at startup
  'src-tauri/src/db/models/dev_tools.rs': [
    'ContextHealthSnapshot', 'CrossProjectRelation', 'DevCompetition', 'DevCompetitionSlot',
    'DevContext', 'DevContextGroup', 'DevContextGroupRelationship', 'DevGoal',
    'DevGoalDependency', 'DevGoalItem', 'DevGoalSignal', 'DevIdea', 'DevKpi', 'DevKpiBinding',
    'DevKpiMeasurement', 'DevPipeline', 'DevProject', 'DevScan', 'DevStandard',
    'DevStrategyStats', 'DevTask', 'DevUseCase', 'DevWorkspace', 'DirectoryScanResult',
    'GitOperationResult', 'GoalProgressSuggestion', 'PendingAcceptanceGoal',
    'PortfolioHealthSummary', 'ProjectHealthEntry', 'RiskMatrixEntry', 'ScanAgentMeta',
    'TechRadarEntry', 'TestRunResult', 'TriageRule', 'WorkspaceImportItem',
    'WorkspaceKnowledge', 'WorkspacePracticeAdoption',
  ],
  'src-tauri/src/db/models/event.rs': [
    'CreateEventSubscriptionInput', 'CreatePersonaEventInput', 'PaginatedEvents',
    'PersonaEvent', 'PersonaEventSubscription', 'UpdateEventSubscriptionInput',
  ],
  'src-tauri/src/db/models/execution.rs': [
    'ExecutionListItem', 'ExecutionSearchResult', 'GlobalExecutionRow', 'PersonaExecution',
  ],
  'src-tauri/src/db/models/execution_annotation.rs': [
    'ExecutionAnnotation',
  ],
  'src-tauri/src/db/models/exposure.rs': [
    'CreateExposedResourceInput', 'CreateProvenanceInput', 'ExposedResource',
    'ExposureManifest', 'ResourceProvenance', 'UpdateExposedResourceInput',
  ],
  'src-tauri/src/db/models/external_api_key.rs': [
    'ApiKeyAuditEntry', 'CreateApiKeyResponse', 'ExternalApiKey',
  ],
  'src-tauri/src/db/models/healing.rs': [
    'HealingKnowledge', 'PersonaHealingIssue',
  ],
  'src-tauri/src/db/models/identity.rs': [
    'IdentityCard', 'LocalIdentity', 'PeerIdentity', 'TrustedPeer', 'UpdateTrustedPeerInput',
  ],
  'src-tauri/src/db/models/knowledge.rs': [
    'ExecutionKnowledge', 'KnowledgeGraphSummary',
  ],
  'src-tauri/src/db/models/llm_spend.rs': [
    'LlmSpendDashboard', 'LlmSpendDay', 'LlmSpendGroup', 'LlmSpendTotals',
  ],
  'src-tauri/src/db/models/memory.rs': [
    'CreatePersonaMemoryInput', 'PersonaMemory',
  ],
  'src-tauri/src/db/models/message.rs': [
    'CreateMessageInput', 'PersonaMessage', 'PersonaMessageDelivery',
  ],
  'src-tauri/src/db/models/n8n_session.rs': [
    'N8nSessionResponse', 'N8nSessionSummary', 'N8nTransformSession',
  ],
  'src-tauri/src/db/models/observability.rs': [
    'AlertRule', 'DashboardCostAnomaly', 'DashboardDailyPoint', 'DashboardTopPersona',
    'ExecutionDashboardData', 'ExecutionHeatmapData', 'FiredAlert', 'HeatmapInsights',
    'MetricAnomaly', 'MetricsChartData', 'MetricsChartPoint', 'MetricsPersonaBreakdown',
    'PersonaCostEntry', 'PersonaMetricsSnapshot', 'PersonaPromptVersion',
    'PromptPerformanceData', 'PromptPerformancePoint', 'VersionMarker',
  ],
  'src-tauri/src/db/models/ocr.rs': [
    'OcrDocument', 'OcrResult',
  ],
  'src-tauri/src/db/models/persona.rs': [
    'ChannelSpecV2', 'CreatePersonaInput', 'Persona', 'PersonaParameter', 'UpdatePersonaInput',
  ],
  'src-tauri/src/db/models/recipe.rs': [
    'CreatePersonaRecipeLinkInput', 'CreateRecipeInput', 'DeriveResult',
    'GenerateRecipeDraftInput', 'PersonaRecipeLink', 'RecipeDefinition', 'RecipeDraft',
    'RecipeExecutionInput', 'RecipeExecutionResult', 'RecipeVersion', 'RecipeVersionDraft',
    'UpdateRecipeInput',
  ],
  'src-tauri/src/db/models/recipe_suggestion.rs': [
    'RecipeSuggestionEvent', 'RecipeSuggestionStats',
  ],
  'src-tauri/src/db/models/review.rs': [
    'CreateManualReviewInput', 'CreateReviewMessageInput', 'PersonaDesignPattern',
    'PersonaDesignReview', 'PersonaManualReview', 'ReviewMessage', 'UpdateManualReviewInput',
  ],
  'src-tauri/src/db/models/rotation.rs': [
    'CreateRotationPolicyInput', 'CredentialRotationEntry', 'CredentialRotationPolicy',
    'UpdateRotationPolicyInput',
  ],
  'src-tauri/src/db/models/saved_views.rs': [
    'CreateSavedViewInput', 'SavedView',
  ],
  'src-tauri/src/db/models/signing.rs': [
    'DocumentSignature', 'SignDocumentResult', 'VerifyDocumentInput', 'VerifyDocumentResult',
  ],
  'src-tauri/src/db/models/sla.rs': [
    'GlobalSlaStats', 'HealingSummary', 'PersonaSlaStats', 'SlaDailyPoint', 'SlaDashboardData',
  ],
  'src-tauri/src/db/models/team.rs': [
    'CreateTeamInput', 'PersonaTeam', 'PersonaTeamConnection', 'PersonaTeamMember',
    'PipelineRun', 'TeamCounts', 'UpdateTeamInput',
  ],
  'src-tauri/src/db/models/team_memory.rs': [
    'CreateTeamMemoryInput', 'TeamMemory', 'TeamMemoryStats',
  ],
  'src-tauri/src/db/models/team_preset.rs': [
    'AdoptedTeamPresetFailure', 'AdoptedTeamPresetMember', 'AdoptedTeamPresetResult',
    'PresetAdoptionSchema', 'PresetMemberAdoptionSchema', 'TeamPreset',
    'TeamPresetAdoptProgress', 'TeamPresetConnection', 'TeamPresetGroupSpec',
    'TeamPresetMember',
  ],
  'src-tauri/src/db/models/template_feedback.rs': [
    'TemplateFeedback', 'TemplatePerformance',
  ],
  'src-tauri/src/db/models/test_run.rs': [
    'PersonaTestResult', 'PersonaTestRun',
  ],
  'src-tauri/src/db/models/tool.rs': [
    'CreateToolDefinitionInput', 'PersonaTool', 'PersonaToolDefinition',
    'UpdateToolDefinitionInput',
  ],
  'src-tauri/src/db/models/tool_audit.rs': [
    'ToolPerformanceSummary',
  ],
  'src-tauri/src/db/models/tool_usage.rs': [
    'PersonaToolUsage', 'PersonaUsageSummary', 'ToolUsageOverTime', 'ToolUsageSummary',
  ],
  'src-tauri/src/db/models/trigger.rs': [
    'CreateTriggerInput', 'PendingTriggerFire', 'PersonaTrigger', 'UpdateTriggerInput',
  ],
  'src-tauri/src/db/models/twin.rs': [
    'TwinChannel', 'TwinCommunication', 'TwinContact', 'TwinDistilledFact', 'TwinPendingMemory',
    'TwinProfile', 'TwinReflection', 'TwinTone', 'TwinVoiceProfile',
  ],
  'src-tauri/src/db/repos/communication/sla.rs': [
    'PersonaDailyReliability', 'PersonaReliability',
  ],
  'src-tauri/src/db/repos/execution/chain_stop_reasons.rs': [
    'ChainStopReason',
  ],
  'src-tauri/src/db/repos/execution/healing.rs': [
    'HealingEffectivenessReport', 'HealingStrategyStat',
  ],
  'src-tauri/src/db/repos/execution/provider_audit.rs': [
    'ProviderUsageStats', 'ProviderUsageTimeseries',
  ],
  'src-tauri/src/db/repos/resources/triggers.rs': [
    'RenameEventTypeResult',
  ],
  'src-tauri/src/engine/api_definition.rs': [
    'ApiEndpoint', 'ApiParameter', 'ApiRequestBody',
  ],
  'src-tauri/src/engine/api_proxy.rs': [
    'ApiProxyResponse',
  ],
  'src-tauri/src/engine/bundle.rs': [
    'BundleExportResult', 'BundleImportOptions', 'BundleImportPreview', 'BundleResourcePreview',
    'BundleVerification', 'NetworkAccessScope',
  ],
  'src-tauri/src/engine/byom.rs': [
    'ByomPolicy', 'ComplianceRule', 'ProviderAuditEntry', 'RoutingRule',
  ],
  'src-tauri/src/engine/capability.rs': [
    'CapabilityHealth',
  ],
  'src-tauri/src/engine/cost.rs': [
    'ExecutionPreview',
  ],
  'src-tauri/src/engine/design.rs': [
    'FeasibilityResult',
  ],
  'src-tauri/src/engine/desktop_discovery.rs': [
    'DiscoveredApp',
  ],
  'src-tauri/src/engine/desktop_security.rs': [
    'DesktopConnectorManifest',
  ],
  'src-tauri/src/engine/dry_run.rs': [
    'DryRunReport', 'DryRunTool',
  ],
  'src-tauri/src/engine/mcp_tools.rs': [
    'McpTool', 'McpToolContent', 'McpToolResult',
  ],
  'src-tauri/src/engine/optimizer.rs': [
    'NodeAnalytics', 'PipelineAnalytics', 'TopologySuggestion',
  ],
  'src-tauri/src/engine/p2p/protocol.rs': [
    'AgentEnvelope',
  ],
  'src-tauri/src/engine/p2p/types.rs': [
    'DiscoveredPeer', 'NetworkStatusInfo', 'PeerManifestEntry',
  ],
  'src-tauri/src/engine/pairing.rs': [
    'PendingPairingView',
  ],
  'src-tauri/src/engine/recipe_eligibility.rs': [
    'RecipeEligibility',
  ],
  'src-tauri/src/engine/recipe_matcher.rs': [
    'RecipeMatch',
  ],
  'src-tauri/src/engine/rotation.rs': [
    'AnomalyScore', 'RotationStatus',
  ],
  'src-tauri/src/engine/share_link.rs': [
    'ResolvedShareLink', 'ShareLinkResult',
  ],
  'src-tauri/src/engine/test_runner.rs': [
    'MockToolResponse', 'TestRunStatusEvent', 'TestScenario', 'TestScores',
  ],
  'src-tauri/src/engine/tool_runner.rs': [
    'ToolInvocationResult', 'ToolTestResult',
  ],
  'src-tauri/src/engine/topology_types.rs': [
    'BlueprintConnection', 'BlueprintMember',
  ],
  'src-tauri/src/engine/trace.rs': [
    'ExecutionTrace', 'TraceSpan',
  ],
  'src-tauri/src/engine/types.rs': [
    'ToolCallStep',
  ],
  'src-tauri/src/engine/workspace_projection.rs': [
    'ProjectionResult',
  ],
  'src-tauri/src/logging.rs': [
    'LogDirectoryStats',
  ],
};

interface ExportedStruct {
  name: string;
  file: string;
  hasCamelRename: boolean;
}

function rustFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) rustFiles(full, out);
    else if (entry.endsWith('.rs')) out.push(full);
  }
  return out;
}

/**
 * Collect `#[ts(export)]` structs and whether their attribute block carries the
 * serde camelCase rename.
 *
 * Hand-rolled line scanner rather than one regex: an attribute block may span
 * multiple lines (`#[derive(\n  ..\n)]`), may interleave doc comments, and may
 * carry any number of attributes between the derive and the `pub struct` line.
 * A single-shot regex over that shape silently drops matches.
 */
export function parseExportedStructs(source: string): Omit<ExportedStruct, 'file'>[] {
  const lines = source.split(/\r?\n/);
  const structs: Omit<ExportedStruct, 'file'>[] = [];
  let block: string[] = [];
  let depth = 0;
  let pending = '';

  const delta = (text: string) => {
    let d = 0;
    for (const ch of text) {
      if (ch === '[' || ch === '(') d++;
      else if (ch === ']' || ch === ')') d--;
    }
    return d;
  };

  for (const raw of lines) {
    const line = raw.trim();

    // Continuation of a multi-line attribute.
    if (depth > 0) {
      pending += '\n' + raw;
      depth += delta(raw);
      if (depth <= 0) {
        block.push(pending);
        pending = '';
        depth = 0;
      }
      continue;
    }

    if (line.startsWith('#[')) {
      const d = delta(raw);
      if (d > 0) {
        depth = d;
        pending = raw;
      } else {
        block.push(raw);
      }
      continue;
    }

    // Doc comments and blank lines sit between attributes and the item without
    // breaking the block; `//` prose mentioning `#[ts(export)]` must NOT count
    // as an attribute (several files document why export is withheld).
    if (line.startsWith('//') || line === '') continue;

    const decl = line.match(/^(?:pub(?:\([^)]*\))?\s+)?(struct|enum)\s+([A-Za-z_]\w*)/);
    if (decl) {
      const attrs = block.join('\n');
      if (decl[1] === 'struct' && /#\[ts\(/.test(attrs) && /\bexport\b/.test(attrs)) {
        structs.push({
          name: decl[2],
          hasCamelRename: /rename_all\s*=\s*"camelCase"/.test(attrs),
        });
      }
      block = [];
      continue;
    }

    block = [];
  }
  return structs;
}

function collectAll(): ExportedStruct[] {
  const all: ExportedStruct[] = [];
  for (const path of rustFiles(RUST_SRC)) {
    const source = readFileSync(path, 'utf-8');
    if (!source.includes('#[ts(')) continue;
    const file = relative(REPO_ROOT, path).replace(/\\/g, '/');
    for (const s of parseExportedStructs(source)) all.push({ ...s, file });
  }
  return all;
}

describe('ts-rs bindings — camelCase ratchet', () => {
  const structs = collectAll();

  it('walks the Rust tree (sanity: layout moved → fix RUST_SRC)', () => {
    expect(structs.length).toBeGreaterThan(600);
  });

  it('every exported struct outside the baseline declares #[serde(rename_all = "camelCase")]', () => {
    const offenders = structs
      .filter((s) => !s.hasCamelRename)
      .filter((s) => !(LEGACY_SNAKE_CASE_BASELINE[s.file] ?? []).includes(s.name))
      .map((s) => `${s.name} (${s.file})`)
      .sort();
    expect(
      offenders,
      `Exported struct(s) missing #[serde(rename_all = "camelCase")]: ${offenders.join(', ')}. ` +
        'Bindings must present camelCase to the frontend — add the attribute and ' +
        'regenerate bindings (cargo test export_bindings). ' +
        'Do NOT add the struct to LEGACY_SNAKE_CASE_BASELINE; that list only shrinks. ' +
        'See ADR 2026-05-10-snake-case-binding-leak.',
    ).toEqual([]);
  });

  it('the baseline only shrinks — renamed or deleted structs must be removed from it', () => {
    const stale: string[] = [];
    for (const [file, names] of Object.entries(LEGACY_SNAKE_CASE_BASELINE)) {
      for (const name of names) {
        const found = structs.find((s) => s.file === file && s.name === name);
        if (!found) stale.push(`${name} (${file}) — no longer an exported struct here`);
        else if (found.hasCamelRename) stale.push(`${name} (${file}) — now camelCase`);
      }
    }
    expect(
      stale.sort(),
      `Baseline entries that no longer belong: ${stale.join('; ')}. ` +
        'Remove them from LEGACY_SNAKE_CASE_BASELINE so the ratchet keeps its tension.',
    ).toEqual([]);
  });
});
