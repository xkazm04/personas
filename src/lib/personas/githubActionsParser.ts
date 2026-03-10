/**
 * Parser for GitHub Actions workflow YAML files.
<<<<<<< HEAD
 * Converts GitHub Actions workflow definitions into AgentIR.
 */

import type { AgentIR } from '@/lib/types/designTypes';
=======
 * Converts GitHub Actions workflow definitions into DesignAnalysisResult.
 */

import type { DesignAnalysisResult } from '@/lib/types/designTypes';
>>>>>>> 4922a97724aa56b26b532cfa6695776f4c697989
import { runExtractionPipeline, type NormalizedNode } from './workflowPipeline';

interface GHAStep {
  name?: string;
  uses?: string;
  run?: string;
  with?: Record<string, unknown>;
  env?: Record<string, unknown>;
  id?: string;
}

interface GHAJob {
  name?: string;
  'runs-on'?: string;
  steps?: GHAStep[];
  needs?: string | string[];
  if?: string;
  env?: Record<string, unknown>;
}

interface GHAWorkflow {
  name?: string;
  on?: unknown;
  jobs?: Record<string, GHAJob>;
  env?: Record<string, unknown>;
}

const GHA_SERVICE_MAP: Record<string, string> = {
  'actions/checkout': 'git',
  'actions/setup-node': 'nodejs',
  'actions/setup-python': 'python',
  'actions/setup-java': 'java',
  'actions/setup-go': 'golang',
  'actions/upload-artifact': 'artifacts',
  'actions/download-artifact': 'artifacts',
  'actions/cache': 'cache',
  'docker/build-push-action': 'docker',
  'docker/login-action': 'docker',
  'aws-actions': 'aws',
  'azure/': 'azure',
  'google-github-actions': 'gcp',
  'slackapi/slack-github-action': 'slack',
  'peter-evans/create-pull-request': 'github',
};

function extractServiceFromUses(uses: string | undefined): string {
  if (!uses) return 'shell';
  const lower = uses.toLowerCase();
  for (const [pattern, service] of Object.entries(GHA_SERVICE_MAP)) {
    if (lower.includes(pattern.toLowerCase())) return service;
  }
  const match = uses.match(/^([^@/]+\/[^@/]+)/);
  if (match) {
    const repo = match[1]?.split('/')[1];
    return repo ? repo.toLowerCase().replace(/[^a-z0-9-]/g, '') : 'action';
  }
  return 'action';
}

function parseTriggers(onConfig: unknown): Array<{
  trigger_type: 'manual' | 'schedule' | 'polling' | 'webhook';
  config: Record<string, unknown>;
  description: string;
}> {
  const triggers: Array<{
    trigger_type: 'manual' | 'schedule' | 'polling' | 'webhook';
    config: Record<string, unknown>;
    description: string;
  }> = [];

  if (!onConfig) return triggers;

  const triggerTypes: string[] = [];
  let triggerConfigs: Record<string, Record<string, unknown>> = {};

  if (typeof onConfig === 'string') {
    triggerTypes.push(onConfig);
  } else if (Array.isArray(onConfig)) {
    triggerTypes.push(...onConfig.filter((t): t is string => typeof t === 'string'));
  } else if (typeof onConfig === 'object') {
    const obj = onConfig as Record<string, unknown>;
    triggerTypes.push(...Object.keys(obj));
    triggerConfigs = obj as Record<string, Record<string, unknown>>;
  }

  for (const type of triggerTypes) {
    const config = (triggerConfigs[type] || {}) as Record<string, unknown>;
    let triggerType: 'manual' | 'schedule' | 'polling' | 'webhook';
    let description: string;

    switch (type) {
      case 'workflow_dispatch':
        triggerType = 'manual';
        description = 'Manual workflow dispatch (GitHub Actions)';
        break;
      case 'schedule':
        triggerType = 'schedule';
        description = Array.isArray(config.cron)
          ? `Scheduled: ${(config.cron as Array<Record<string, string>>).map((c) => c.cron || '').join(', ')}`
          : `Scheduled (GitHub Actions cron)`;
        break;
      case 'push':
        triggerType = 'webhook';
        description = `Push event${config.branches ? ` on ${JSON.stringify(config.branches)}` : ''}`;
        break;
      case 'pull_request':
      case 'pull_request_target':
        triggerType = 'webhook';
        description = `Pull request event${config.types ? ` (${JSON.stringify(config.types)})` : ''}`;
        break;
      case 'repository_dispatch':
        triggerType = 'webhook';
        description = 'Repository dispatch event';
        break;
      case 'workflow_call':
        triggerType = 'webhook';
        description = 'Reusable workflow call';
        break;
      default:
        triggerType = 'webhook';
        description = `${type} event (GitHub Actions)`;
        break;
    }

    triggers.push({ trigger_type: triggerType, config, description });
  }

  return triggers;
}

<<<<<<< HEAD
export function parseGithubActionsWorkflow(json: unknown): AgentIR {
=======
export function parseGithubActionsWorkflow(json: unknown): DesignAnalysisResult {
>>>>>>> 4922a97724aa56b26b532cfa6695776f4c697989
  if (!json || typeof json !== 'object') {
    throw new Error('Invalid GitHub Actions workflow: expected an object');
  }

  const workflow = json as GHAWorkflow;
  const record = json as Record<string, unknown>;
  const onConfig = workflow.on ?? record['true'] ?? record.on;
  const jobsObj = workflow.jobs;

  if (!jobsObj || typeof jobsObj !== 'object' || Object.keys(jobsObj).length === 0) {
    throw new Error('Invalid GitHub Actions workflow: no jobs found');
  }

  // Extract triggers from `on` configuration (GHA-specific logic)
  const ghaTriggers = parseTriggers(onConfig);

  // Extract steps from all jobs as normalized nodes
  const nodes: NormalizedNode[] = [];
  for (const [jobId, job] of Object.entries(jobsObj)) {
    if (!job || typeof job !== 'object') continue;
    const jobName = job.name || jobId;
    for (const step of job.steps || []) {
      const service = step.uses ? extractServiceFromUses(step.uses) : 'shell';
      nodes.push({
        label: step.name || step.id || step.uses || 'run command',
        service,
        isTrigger: false,
        config: (step.with || {}) as Record<string, unknown>,
        sourceDescription: `${jobName}/${step.uses || 'run'}`,
        rawType: step.uses || 'shell',
      });
    }
  }

  // GHA has custom identity/instructions, so we override the pipeline output
  const result = runExtractionPipeline({
    platformLabel: 'GitHub Actions',
    platformNoun: 'workflow',
    elementNoun: 'steps',
    workflowName: workflow.name || 'Imported GitHub Actions Workflow',
    nodes,
    excludedServices: ['shell', 'action', 'cache', 'artifacts'],
    // Pass pre-computed triggers instead of fallback (GHA handles its own trigger parsing)
    fallbackTriggers: ghaTriggers.length > 0 ? undefined : [{
      trigger_type: 'manual',
      config: {},
      description: 'Manual trigger (no trigger detected)',
    }],
  });

  // Replace triggers with GHA-specific ones (pipeline would produce none since all nodes are non-trigger)
  if (ghaTriggers.length > 0) {
    result.suggested_triggers = ghaTriggers;
  }

  // Override identity and instructions with GHA-specific versions
  const jobEntries = Object.entries(jobsObj);
  result.structured_prompt.identity = `You are an AI agent that orchestrates the "${workflow.name || 'Imported GitHub Actions Workflow'}" CI/CD pipeline, originally defined as a GitHub Actions workflow.`;
  result.structured_prompt.instructions = `Execute the following jobs in order:\n${jobEntries.map(([id, j], i) => {
    const job = j as GHAJob;
    const stepCount = job.steps?.length ?? 0;
    return `${i + 1}. ${job.name || id} (${stepCount} steps, runs on ${job['runs-on'] || 'unknown'})`;
  }).join('\n')}\n\nRespect job dependencies and pass artifacts between jobs as needed.`;
  result.structured_prompt.errorHandling = 'If any step fails, check the job\'s continue-on-error setting. By default, stop the job on failure and report the error. For independent jobs, continue execution.';

  // Override summary/markdown with job-level detail
  const jobNames = jobEntries.map(([id, j]) => (j as GHAJob).name || id);
  result.full_prompt_markdown = `# ${workflow.name || 'Imported GitHub Actions Workflow'}\n\nJobs: ${jobNames.join(' \u2192 ')}\n\nThis persona was imported from a GitHub Actions workflow with ${jobEntries.length} jobs and ${nodes.length} total steps.`;
  result.summary = `Imported from GitHub Actions workflow "${workflow.name || 'Imported GitHub Actions Workflow'}" with ${jobEntries.length} jobs and ${nodes.length} steps.`;

  return result;
}
