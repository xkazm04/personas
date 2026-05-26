/**
 * Seed the 6 SDLC-team recipes derived from the 5 from-scratch personas
 * (Architecture Solution Guide, Code Reviewer, Release Manager, Security
 * Sentinel, Docs Steward) into scripts/templates/_recipe_seeds.json.
 *
 * Each recipe is the hydrated use-case definition that the matching template's
 * `use_cases[].recipe_ref` points at. The recipe `id` constants here MUST equal
 * the recipe_ref ids in the template JSON (scripts/templates/{development,devops,
 * security}/<id>.json) — they are exported so the templates stay in lock-step.
 *
 * INSERT-ONLY: keyed on (source_template_id, source_use_case_id), matching the
 * Rust seeder (src-tauri/src/engine/recipe_seed.rs). Re-running never overwrites
 * an existing row; it only appends new ones and bumps recipe_count.
 *
 * Generalization: the source personas were bookkeeper-specific. These recipes
 * are stack-neutral ("your codebase", "the registered repository") and lift
 * project specifics into template adoption_questions / {{param.*}} tokens. The
 * cross-persona event contract (architecture.analysis.completed, code_review.completed,
 * security.scan.completed, release.published, docs.sync.completed) is preserved so
 * the SDLC team preset can wire the handoffs.
 *
 * Usage: node scripts/seed-sdlc-recipes.mjs   (idempotent)
 */
import { readFileSync, writeFileSync } from 'node:fs';

// Recipe UUIDs — shared with the template recipe_refs. Stable + hand-assigned.
export const RECIPE_IDS = {
  uc_architecture_review: '5dc1a001-a5c0-4a01-9e01-5dc1a0010001',
  uc_idea_architecture_analysis: '5dc1a002-a5c0-4a02-9e02-5dc1a0020002',
  uc_code_review: '5dc1a003-a5c0-4a03-9e03-5dc1a0030003',
  uc_release_automation: '5dc1a004-a5c0-4a04-9e04-5dc1a0040004',
  uc_security_scan: '5dc1a005-a5c0-4a05-9e05-5dc1a0050005',
  uc_docs_sync: '5dc1a006-a5c0-4a06-9e06-5dc1a0060006',
};

const codebaseInput = {
  name: 'target_codebase',
  type: 'connector_ref',
  ui_component: 'CodebaseSelector',
  connector: 'codebase',
  required: true,
  description: 'Which registered codebase this capability reads (and, where applicable, writes) — no code leaves your machine.',
};

/** Each entry → one recipe. `pt` is the full prompt_template (hydrated use case). */
const RECIPES = [
  // ───────────────────────── Solution Architect ─────────────────────────
  {
    template: 'solution-architect',
    pt: {
      id: 'uc_architecture_review',
      title: 'Scheduled Architecture Review',
      description: 'Periodic architectural health review of the registered codebase: scan the current architecture, trace cross-module impacts, and produce a concise ADR (context / decision / consequences) plus a story-pointed task breakdown. Reads memory for prior decisions so each review builds on the architectural record instead of restating it.',
      capability_summary: 'On a schedule, review codebase architecture and publish an ADR + task breakdown, tracking decisions in memory.',
      category: 'development',
      enabled_by_default: true,
      execution_mode: 'e2e',
      model_override: null,
      suggested_trigger: {
        trigger_type: 'schedule',
        config: { cron: '0 9 * * 1', cadence: 'weekly' },
        description: 'Runs on a schedule (default weekly). Cadence is configurable at the trigger-composition step; can also be run manually.',
      },
      connectors: ['codebase'],
      notification_channels: [{ type: 'messaging', description: 'Architecture review summary: ADR title, key decisions, task count + total story points.' }],
      review_policy: { mode: 'never', context: 'Architecture reviews are published as advisory ADRs — no human approval gate; the team triages the resulting tasks.' },
      memory_policy: { enabled: true, context: 'REQUIRED. Persist the architectural decision record across runs: prior ADRs (context/decision/consequences), modules already analyzed, and standing constraints. Each run reads memory first so it extends the architectural history and avoids re-deriving settled decisions.' },
      event_subscriptions: [
        { event_type: 'architecture.analysis.completed', direction: 'emit', description: 'Payload: { adr, tasks[], effort_estimate }. Emitted after each review so downstream agents (code review, dev) can act on the plan.' },
        { event_type: 'architecture.review.completed', direction: 'listen', description: 'Re-run a targeted review when an upstream review-completed signal arrives.' },
      ],
      error_handling: 'Codebase not accessible → report \'codebase not accessible\' and stop (no value possible — precondition_failed). Partial file access → proceed with available files and note the coverage limitation in the ADR. Never block the pipeline on a single tool failure; emit the ADR + tasks with whatever was analyzable.',
      input_schema: [
        codebaseInput,
        { name: 'focus_areas', type: 'text', required: false, description: 'Optional comma-separated subsystems to prioritize (e.g. "auth, data layer"). Empty = whole-codebase health pass.' },
        { name: 'story_point_scale', type: 'number', default: 8, min: 5, max: 21, description: 'Upper bound of the story-point scale used for task estimates (1..N).' },
      ],
      sample_input: { target_codebase: '{{param.aq_target_codebase}}', focus_areas: '', story_point_scale: 8 },
      tool_hints: ['file_read', 'search_code', 'file_write'],
      test_fixtures: [],
      use_case_flow: {
        nodes: [
          { id: 'a1', type: 'start', label: 'Scheduled run' },
          { id: 'a2', type: 'action', label: 'Read memory: prior ADRs + constraints' },
          { id: 'a3', type: 'connector', label: 'Scan codebase architecture', connector: 'codebase' },
          { id: 'a4', type: 'action', label: 'Trace cross-module impacts' },
          { id: 'a5', type: 'action', label: 'Draft ADR (context/decision/consequences)' },
          { id: 'a6', type: 'action', label: 'Build story-pointed task breakdown' },
          { id: 'a7', type: 'action', label: 'Persist decisions to memory' },
          { id: 'a8', type: 'event', label: 'Emit architecture.analysis.completed' },
          { id: 'a9', type: 'end', label: 'Publish ADR + tasks' },
        ],
        edges: [
          { source: 'a1', target: 'a2' }, { source: 'a2', target: 'a3' }, { source: 'a3', target: 'a4' },
          { source: 'a4', target: 'a5' }, { source: 'a5', target: 'a6' }, { source: 'a6', target: 'a7' },
          { source: 'a7', target: 'a8' }, { source: 'a8', target: 'a9' },
        ],
      },
    },
  },
  {
    template: 'solution-architect',
    pt: {
      id: 'uc_idea_architecture_analysis',
      title: 'Idea Architecture Analysis',
      description: 'On-demand architectural evaluation of a proposed change or accepted idea: assess fit against the existing architecture, surface risks and trade-offs, and produce an implementation plan (ADR + scoped, story-pointed tasks) ready for a delivery agent to pick up.',
      capability_summary: 'Evaluate a proposed idea against the architecture and emit a scoped implementation plan for downstream delivery.',
      category: 'development',
      enabled_by_default: true,
      execution_mode: 'e2e',
      model_override: null,
      suggested_trigger: {
        trigger_type: 'event',
        config: { listen_event_type: 'team.idea.accepted' },
        description: 'Fires when an idea is accepted upstream (e.g. by a triage agent), or can be run manually with an idea description.',
      },
      connectors: ['codebase'],
      notification_channels: [{ type: 'messaging', description: 'Implementation plan summary: feasibility verdict, key risks, task count + effort.' }],
      review_policy: { mode: 'never', context: 'Plans are advisory; the team decides whether to schedule the work.' },
      memory_policy: { enabled: true, context: 'Persist evaluated ideas + their verdicts so repeat or related proposals are assessed against prior decisions rather than re-analyzed cold.' },
      event_subscriptions: [
        { event_type: 'team.idea.accepted', direction: 'listen', description: 'Payload: { idea_description, requirements, priority }. Triggers an architecture analysis of the accepted idea.' },
        { event_type: 'architecture.analysis.completed', direction: 'emit', description: 'Payload: { adr, tasks[], effort_estimate, feasibility }. Hands the scoped plan to delivery agents.' },
      ],
      error_handling: 'Codebase not accessible → analyze from the idea description + stated requirements and clearly mark assumptions as UNVERIFIED in the ADR. Never report \'blocked\' — always emit a best-effort plan + the architecture.analysis.completed event.',
      input_schema: [
        codebaseInput,
        { name: 'idea_description', type: 'text', required: true, description: 'The proposed change / feature to evaluate.' },
        { name: 'requirements', type: 'text', required: false, description: 'Constraints the solution must satisfy (integrations, stack, non-functionals).' },
        { name: 'priority', type: 'enum', options: ['low', 'normal', 'high'], default: 'normal', required: false, description: 'Relative priority of the idea.' },
      ],
      sample_input: { target_codebase: '{{param.aq_target_codebase}}', idea_description: 'Add real-time notifications for high-value events', requirements: 'Must fit the existing event/state architecture', priority: 'high' },
      tool_hints: ['file_read', 'search_code', 'file_write'],
      test_fixtures: [],
      use_case_flow: {
        nodes: [
          { id: 'i1', type: 'start', label: 'Idea accepted / manual run' },
          { id: 'i2', type: 'action', label: 'Read memory: prior related decisions' },
          { id: 'i3', type: 'connector', label: 'Inspect affected modules', connector: 'codebase' },
          { id: 'i4', type: 'decision', label: 'Fits current architecture?' },
          { id: 'i5', type: 'action', label: 'Draft ADR + scoped tasks (fit path)' },
          { id: 'i6', type: 'action', label: 'Draft ADR + risks + alternatives (mismatch path)' },
          { id: 'i7', type: 'event', label: 'Emit architecture.analysis.completed' },
          { id: 'i8', type: 'end', label: 'Hand plan to delivery' },
        ],
        edges: [
          { source: 'i1', target: 'i2' }, { source: 'i2', target: 'i3' }, { source: 'i3', target: 'i4' },
          { source: 'i4', target: 'i5', variant: 'yes', label: 'Yes' }, { source: 'i4', target: 'i6', variant: 'no', label: 'Needs change' },
          { source: 'i5', target: 'i7' }, { source: 'i6', target: 'i7' }, { source: 'i7', target: 'i8' },
        ],
      },
    },
  },
  // ───────────────────────── Code Reviewer ─────────────────────────
  {
    template: 'code-reviewer',
    pt: {
      id: 'uc_code_review',
      title: 'Code Review',
      description: 'Reviews target files (or a changeset) for security vulnerabilities, correctness bugs, and quality issues. Every finding cites file:line with a concrete fix; closes with an APPROVE / REQUEST_CHANGES verdict. Reads memory for prior findings so resolved issues are not re-flagged and recurring patterns are tracked.',
      capability_summary: 'Review code for security/correctness/quality, cite file:line fixes, and return an APPROVE/REQUEST_CHANGES verdict.',
      category: 'development',
      enabled_by_default: true,
      execution_mode: 'e2e',
      model_override: 'claude-sonnet-4-6',
      suggested_trigger: {
        trigger_type: 'manual',
        config: {},
        description: 'Run on demand against a set of files or a changeset; can also be wired to a PR/changeset event.',
      },
      connectors: ['codebase'],
      notification_channels: [{ type: 'messaging', description: 'Review report: findings by severity + verdict.' }],
      review_policy: { mode: 'on_request', context: 'The verdict is published automatically, but a REQUEST_CHANGES with critical findings can be surfaced for human confirmation before it gates downstream work.' },
      memory_policy: { enabled: true, context: 'Persist findings by file:line signature + their resolution so the reviewer does not re-flag accepted/resolved items and can note recurring anti-patterns across reviews.' },
      event_subscriptions: [
        { event_type: 'code_review.completed', direction: 'emit', description: 'Payload: { verdict, findings_count, critical_count }. Lets downstream agents (security, release) gate on the review outcome.' },
      ],
      error_handling: 'On file/tool failure: log it, mark the review INCOMPLETE, and report REQUEST_CHANGES explaining that full analysis could not run. NEVER return APPROVE when analysis was blocked — an unreviewed change is not an approved change.',
      input_schema: [
        codebaseInput,
        { name: 'file_paths', type: 'text', required: false, description: 'Comma-separated files to review. Empty = review the most recent changeset the connector exposes.' },
        { name: 'review_scope', type: 'enum', options: ['all', 'security', 'correctness', 'quality'], default: 'all', required: false, description: 'Narrow the review focus, or review all dimensions.' },
      ],
      sample_input: { target_codebase: '{{param.aq_target_codebase}}', file_paths: '', review_scope: 'all' },
      tool_hints: ['file_read', 'search_code'],
      test_fixtures: [],
      use_case_flow: {
        nodes: [
          { id: 'r1', type: 'start', label: 'Review requested' },
          { id: 'r2', type: 'action', label: 'Read memory: prior findings + resolutions' },
          { id: 'r3', type: 'connector', label: 'Read target files / changeset', connector: 'codebase' },
          { id: 'r4', type: 'action', label: 'Security + correctness + quality analysis' },
          { id: 'r5', type: 'decision', label: 'Critical / security issues?' },
          { id: 'r6', type: 'action', label: 'REQUEST_CHANGES + file:line fixes' },
          { id: 'r7', type: 'action', label: 'APPROVE + notes' },
          { id: 'r8', type: 'event', label: 'Emit code_review.completed' },
          { id: 'r9', type: 'end', label: 'Publish review' },
        ],
        edges: [
          { source: 'r1', target: 'r2' }, { source: 'r2', target: 'r3' }, { source: 'r3', target: 'r4' },
          { source: 'r4', target: 'r5' }, { source: 'r5', target: 'r6', variant: 'yes', label: 'Yes' },
          { source: 'r5', target: 'r7', variant: 'no', label: 'Clean' }, { source: 'r6', target: 'r8' },
          { source: 'r7', target: 'r8' }, { source: 'r8', target: 'r9' },
        ],
      },
    },
  },
  // ───────────────────────── Release Manager ─────────────────────────
  {
    template: 'release-manager',
    pt: {
      id: 'uc_release_automation',
      title: 'Release Automation',
      description: 'When a change merges, applies semantic-versioning rules (MAJOR/MINOR/PATCH) to the merged commits, bumps the version file, prepends a categorized changelog entry, drafts release notes, and tags the release. Records each version decision in memory so the version history is reasoned about, not just incremented.',
      capability_summary: 'On merge, bump semver, update changelog, draft release notes, and tag — recording version decisions in memory.',
      category: 'development',
      enabled_by_default: true,
      execution_mode: 'e2e',
      model_override: 'claude-sonnet-4-6',
      suggested_trigger: {
        trigger_type: 'event',
        config: { listen_event_type: 'github.pull_request.merged' },
        description: 'Fires when a pull request merges to the main branch (GitHub connector), or can be run manually after a local merge.',
      },
      connectors: ['codebase', 'github'],
      notification_channels: [{ type: 'messaging', description: 'Release summary: new version, bump rationale, headline changes.' }],
      review_policy: { mode: 'never', context: 'Release automation runs without a human gate; version decisions are logged to memory for audit.' },
      memory_policy: { enabled: true, context: 'Persist every version decision (version, bump type, rationale) so semantic-versioning choices are consistent and auditable across releases.' },
      event_subscriptions: [
        { event_type: 'github.pull_request.merged', direction: 'listen', description: 'Payload: { pull_request, merge_commit_sha, base_branch }. Triggers a version bump for the merged change.' },
        { event_type: 'release.published', direction: 'emit', description: 'Payload: { version, changes }. Announces the cut release to downstream agents (e.g. docs).' },
        { event_type: 'release.version.bumped', direction: 'emit', description: 'Payload: { version, bump_type }. Emitted when the version file is updated.' },
      ],
      error_handling: 'Version file not found → default to a PATCH bump and note the assumption. Changelog write failure → back up the existing file and retry. Tag conflict → increment patch and retry. GitHub/codebase unavailable → run on a best-effort basis from available data and still emit release.version.bumped + release.published. Never block the release on a single tool failure.',
      input_schema: [
        codebaseInput,
        { name: 'base_branch', type: 'text', default: 'main', required: false, description: 'The branch releases are cut from.' },
        { name: 'release_note_length', type: 'enum', options: ['short', 'standard', 'detailed'], default: 'standard', required: false, description: 'How verbose the drafted release notes should be.' },
        { name: 'changelog_style', type: 'enum', options: ['keepachangelog', 'conventional', 'plain'], default: 'keepachangelog', required: false, description: 'Changelog entry format.' },
      ],
      sample_input: { target_codebase: '{{param.aq_target_codebase}}', base_branch: 'main', release_note_length: '{{param.aq_release_note_length}}', changelog_style: '{{param.aq_changelog_style}}' },
      tool_hints: ['file_read', 'file_write', 'search_code'],
      test_fixtures: [],
      use_case_flow: {
        nodes: [
          { id: 'v1', type: 'start', label: 'PR merged / manual' },
          { id: 'v2', type: 'action', label: 'Read memory: prior version decisions' },
          { id: 'v3', type: 'connector', label: 'Analyze merged commits + diff', connector: 'codebase' },
          { id: 'v4', type: 'decision', label: 'Bump type (MAJOR/MINOR/PATCH)' },
          { id: 'v5', type: 'connector', label: 'Update version file + changelog', connector: 'codebase' },
          { id: 'v6', type: 'action', label: 'Draft release notes + create tag' },
          { id: 'v7', type: 'action', label: 'Persist version decision to memory' },
          { id: 'v8', type: 'event', label: 'Emit release.version.bumped + release.published' },
          { id: 'v9', type: 'end', label: 'Release published' },
        ],
        edges: [
          { source: 'v1', target: 'v2' }, { source: 'v2', target: 'v3' }, { source: 'v3', target: 'v4' },
          { source: 'v4', target: 'v5' }, { source: 'v5', target: 'v6' }, { source: 'v6', target: 'v7' },
          { source: 'v7', target: 'v8' }, { source: 'v8', target: 'v9' },
        ],
      },
    },
  },
  // ───────────────────────── Security Sentinel ─────────────────────────
  {
    template: 'security-sentinel',
    pt: {
      id: 'uc_security_scan',
      title: 'On-Demand Security Scan',
      description: 'Comprehensive security audit of the registered codebase: dependency-vulnerability analysis, secret/credential detection, and risky-pattern analysis (auth bypasses, PII handling, injection). Findings are severity-ranked with concrete remediation. Tracks reported findings in memory to dedupe across scans.',
      capability_summary: 'Scan the codebase for dependency CVEs, secrets, and risky patterns; file severity-ranked findings with fixes, deduped via memory.',
      category: 'security',
      enabled_by_default: true,
      execution_mode: 'e2e',
      model_override: 'claude-sonnet-4-6',
      suggested_trigger: {
        trigger_type: 'manual',
        config: {},
        description: 'Run on demand; can also be scheduled or wired to a post-merge event for continuous assurance.',
      },
      connectors: ['codebase'],
      notification_channels: [{ type: 'messaging', description: 'Security report: findings by severity (Critical/High/Medium/Low) + counts.' }],
      review_policy: { mode: 'on_request', context: 'Findings are published for human triage; the human decides remediation priority. Critical findings can be surfaced for confirmation.' },
      memory_policy: { enabled: true, context: 'Persist reported findings by stable signature (file:line + rule) so re-scans do not duplicate known issues and can show what was fixed vs. still open.' },
      event_subscriptions: [
        { event_type: 'security.scan.completed', direction: 'emit', description: 'Payload: { status, findings_count, critical_count, scan_path }. Lets downstream agents gate on the security posture.' },
      ],
      error_handling: 'Dependency audit unavailable → continue with code-pattern + secret analysis and flag the missing dependency scan. Tool timeout → save partial results and continue the next phase. Codebase partially accessible → scan what is available and note coverage. Never abort entirely — partial security coverage is better than none — but always emit security.scan.completed with the coverage caveat.',
      input_schema: [
        codebaseInput,
        { name: 'scan_path', type: 'text', default: 'src/', required: false, description: 'Subtree to scan; empty / "." = whole repo.' },
        { name: 'severity_threshold', type: 'enum', options: ['low', 'medium', 'high', 'critical'], default: 'medium', required: false, description: 'Report findings at or above this severity.' },
        { name: 'max_findings_per_category', type: 'number', default: 20, min: 1, max: 100, description: 'Cap findings per category to keep the report actionable.' },
        { name: 'scan_depth', type: 'number', default: 6, min: 1, max: 20, description: 'Maximum directory depth to scan.' },
      ],
      sample_input: { target_codebase: '{{param.aq_target_codebase}}', scan_path: 'src/', severity_threshold: '{{param.aq_severity_threshold}}', max_findings_per_category: 20, scan_depth: 6 },
      tool_hints: ['file_read', 'search_code'],
      test_fixtures: [],
      use_case_flow: {
        nodes: [
          { id: 's1', type: 'start', label: 'Scan requested' },
          { id: 's2', type: 'action', label: 'Read memory: prior findings' },
          { id: 's3', type: 'connector', label: 'Dependency vuln analysis', connector: 'codebase' },
          { id: 's4', type: 'connector', label: 'Secret / credential detection', connector: 'codebase' },
          { id: 's5', type: 'connector', label: 'Risky-pattern analysis (auth/PII/injection)', connector: 'codebase' },
          { id: 's6', type: 'action', label: 'Severity-rank + dedupe vs memory' },
          { id: 's7', type: 'action', label: 'File new findings + remediation' },
          { id: 's8', type: 'event', label: 'Emit security.scan.completed' },
          { id: 's9', type: 'end', label: 'Publish report' },
        ],
        edges: [
          { source: 's1', target: 's2' }, { source: 's2', target: 's3' }, { source: 's3', target: 's4' },
          { source: 's4', target: 's5' }, { source: 's5', target: 's6' }, { source: 's6', target: 's7' },
          { source: 's7', target: 's8' }, { source: 's8', target: 's9' },
        ],
      },
    },
  },
  // ───────────────────────── Docs Steward ─────────────────────────
  {
    template: 'docs-steward',
    pt: {
      id: 'uc_docs_sync',
      title: 'Sync Documentation',
      description: 'Analyzes recent commits, identifies functional changes (ignoring formatting/test-only), and updates README sections + the changelog so docs match the shipped code. Reads memory for the last-processed commit so each run only covers new changes.',
      capability_summary: 'Keep README + changelog in sync with shipped code by analyzing new commits since the last processed point.',
      category: 'development',
      enabled_by_default: true,
      execution_mode: 'e2e',
      model_override: 'claude-sonnet-4-6',
      suggested_trigger: {
        trigger_type: 'manual',
        config: {},
        description: 'Run on demand, on a schedule, or wired to a release.published event to refresh docs after each release.',
      },
      connectors: ['codebase'],
      notification_channels: [{ type: 'messaging', description: 'Doc sync summary: files updated, commits processed, change categories.' }],
      review_policy: { mode: 'never', context: 'Documentation updates are low-risk and easily reverted — published automatically.' },
      memory_policy: { enabled: true, context: 'Persist the last-processed commit hash so each run only analyzes new commits since the previous sync instead of the whole history.' },
      event_subscriptions: [
        { event_type: 'release.published', direction: 'listen', description: 'Payload: { version, changes }. Refresh docs to reflect the newly released change.' },
        { event_type: 'docs.sync.completed', direction: 'emit', description: 'Payload: { files_updated, commit_hash }. Signals docs are current as of a commit.' },
      ],
      error_handling: 'Git/codebase access failure → report it and suggest checking the repository path; do not fabricate doc changes. File write failure → create a backup and retry. Update README and changelog together or revert both — never leave docs half-updated. Skip trivial (formatting/comment/test-only) changes.',
      input_schema: [
        codebaseInput,
        { name: 'target_files', type: 'text', default: 'README.md, CHANGELOG.md', required: false, description: 'Documentation files to keep in sync.' },
        { name: 'commit_range', type: 'text', required: false, description: 'Git range to analyze (e.g. HEAD~10..HEAD). Empty = since the last processed commit in memory.' },
      ],
      sample_input: { target_codebase: '{{param.aq_target_codebase}}', target_files: 'README.md, CHANGELOG.md', commit_range: '' },
      tool_hints: ['file_read', 'file_write', 'search_code'],
      test_fixtures: [],
      use_case_flow: {
        nodes: [
          { id: 'd1', type: 'start', label: 'Sync requested / release published' },
          { id: 'd2', type: 'action', label: 'Read memory: last-processed commit' },
          { id: 'd3', type: 'connector', label: 'Query new commits + diffs', connector: 'codebase' },
          { id: 'd4', type: 'decision', label: 'Functional changes present?' },
          { id: 'd5', type: 'action', label: 'Categorize changes (feature/fix/breaking)' },
          { id: 'd6', type: 'connector', label: 'Update README + changelog', connector: 'codebase' },
          { id: 'd7', type: 'action', label: 'Persist last-processed commit' },
          { id: 'd8', type: 'event', label: 'Emit docs.sync.completed' },
          { id: 'd9', type: 'action', label: "Report 'docs already current'" },
          { id: 'd10', type: 'end', label: 'Done' },
        ],
        edges: [
          { source: 'd1', target: 'd2' }, { source: 'd2', target: 'd3' }, { source: 'd3', target: 'd4' },
          { source: 'd4', target: 'd5', variant: 'yes', label: 'Yes' }, { source: 'd4', target: 'd9', variant: 'no', label: 'None' },
          { source: 'd5', target: 'd6' }, { source: 'd6', target: 'd7' }, { source: 'd7', target: 'd8' },
          { source: 'd8', target: 'd10' }, { source: 'd9', target: 'd10' },
        ],
      },
    },
  },
];

// ───────────────────────── seed (insert-only) ─────────────────────────
const SEEDS_PATH = 'scripts/templates/_recipe_seeds.json';
const seeds = JSON.parse(readFileSync(SEEDS_PATH, 'utf8'));

// Heal: the Rust RecipeSeed struct types `tags` as Option<String> (the value is
// a JSON-encoded array string, e.g. "[\"x\",\"derived\"]"), NOT a JSON array.
// A raw array breaks the whole bundle's serde parse at startup. Normalize any
// array-typed tags (e.g. rows an earlier version of this script wrote) to the
// stringified form so the include_str! bundle deserializes.
let healed = 0;
for (const r of seeds.recipes) {
  if (Array.isArray(r.tags)) { r.tags = JSON.stringify(r.tags); healed++; }
}
if (healed) console.log(`healed ${healed} row(s) with array-typed tags -> string`);

const existing = new Set(seeds.recipes.map((r) => `${r.source_template_id}::${r.source_use_case_id}`));

let added = 0;
for (const { template, pt } of RECIPES) {
  const key = `${template}::${pt.id}`;
  if (existing.has(key)) { console.log(`skip (exists): ${key}`); continue; }
  const id = RECIPE_IDS[pt.id];
  if (!id) throw new Error(`no RECIPE_IDS entry for ${pt.id}`);
  seeds.recipes.push({
    id,
    source_template_id: template,
    source_use_case_id: pt.id,
    source_use_case_name: pt.id,
    source_version: '1.0.0',
    name: pt.id,
    description: pt.description,
    category: pt.category,
    prompt_template: JSON.stringify(pt),
    tool_requirements: null,
    tags: JSON.stringify([template, 'derived']),
  });
  existing.add(key);
  added++;
  console.log(`added: ${key} -> ${id}`);
}

seeds.recipe_count = seeds.recipes.length;
writeFileSync(SEEDS_PATH, JSON.stringify(seeds, null, 2) + '\n');
console.log(`\n${added} recipe(s) added. recipe_count=${seeds.recipe_count}`);
