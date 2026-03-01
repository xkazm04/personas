/**
 * Parser for GitHub Actions workflow YAML files.
 * Converts GitHub Actions workflow definitions into DesignAnalysisResult.
 *
 * GitHub Actions workflows have:
 * - `on` key defining triggers (push, pull_request, schedule, workflow_dispatch, etc.)
 * - `jobs` object with job definitions containing `steps` arrays
 */

import type { DesignAnalysisResult } from '@/lib/types/designTypes';

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
  // Extract org/repo from "org/repo@version"
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

  if (!onConfig) {
    triggers.push({
      trigger_type: 'manual',
      config: {},
      description: 'Manual trigger (no trigger defined)',
    });
    return triggers;
  }

  // `on` can be a string, array of strings, or object
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

  if (triggers.length === 0) {
    triggers.push({
      trigger_type: 'manual',
      config: {},
      description: 'Manual trigger (no trigger detected)',
    });
  }

  return triggers;
}

export function parseGithubActionsWorkflow(json: unknown): DesignAnalysisResult {
  if (!json || typeof json !== 'object') {
    throw new Error('Invalid GitHub Actions workflow: expected an object');
  }

  const workflow = json as GHAWorkflow;

  // Handle YAML parsing quirk where `on:` becomes `true:` key
  const record = json as Record<string, unknown>;
  const onConfig = workflow.on ?? record['true'] ?? record.on;
  const jobsObj = workflow.jobs;

  if (!jobsObj || typeof jobsObj !== 'object' || Object.keys(jobsObj).length === 0) {
    throw new Error('Invalid GitHub Actions workflow: no jobs found');
  }

  // Extract triggers from `on` configuration
  const triggers = parseTriggers(onConfig);

  // Extract steps from all jobs
  const services = new Set<string>();
  const allSteps: Array<GHAStep & { jobName: string }> = [];

  for (const [jobId, job] of Object.entries(jobsObj)) {
    if (!job || typeof job !== 'object') continue;
    const jobName = job.name || jobId;
    for (const step of job.steps || []) {
      allSteps.push({ ...step, jobName });
    }
  }

  const toolNames = allSteps.map((step) => {
    const service = step.uses ? extractServiceFromUses(step.uses) : 'shell';
    services.add(service);
    const label = (step.name || step.id || step.uses || 'run').toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
    return `${service}_${label}`;
  });

  const connectors = Array.from(services)
    .filter((s) => !['shell', 'action', 'cache', 'artifacts'].includes(s))
    .map((service) => ({
      name: service,
      credential_fields: [] as Array<{
        key: string;
        label: string;
        type: 'text' | 'password' | 'url';
        placeholder?: string;
        helpText?: string;
        required?: boolean;
      }>,
      related_tools: toolNames.filter((t) => t.startsWith(service)),
      related_triggers: [] as number[],
    }));

  const workflowName = workflow.name || 'Imported GitHub Actions Workflow';
  const jobNames = Object.entries(jobsObj).map(([id, j]) => (j as GHAJob).name || id);
  const jobSequence = jobNames.join(' \u2192 ');

  return {
    structured_prompt: {
      identity: `You are an AI agent that orchestrates the "${workflowName}" CI/CD pipeline, originally defined as a GitHub Actions workflow.`,
      instructions: `Execute the following jobs in order:\n${Object.entries(jobsObj).map(([id, j], i) => {
        const job = j as GHAJob;
        const stepCount = job.steps?.length ?? 0;
        return `${i + 1}. ${job.name || id} (${stepCount} steps, runs on ${job['runs-on'] || 'unknown'})`;
      }).join('\n')}\n\nRespect job dependencies and pass artifacts between jobs as needed.`,
      toolGuidance: allSteps.length > 0
        ? `Execute the following steps: ${allSteps.map((s) => s.name || s.uses || 'run command').join(', ')}.`
        : 'No specific tools required.',
      examples: '',
      errorHandling: 'If any step fails, check the job\'s continue-on-error setting. By default, stop the job on failure and report the error. For independent jobs, continue execution.',
      customSections: [],
    },
    suggested_tools: toolNames,
    suggested_triggers: triggers,
    full_prompt_markdown: `# ${workflowName}\n\nJobs: ${jobSequence}\n\nThis persona was imported from a GitHub Actions workflow with ${Object.keys(jobsObj).length} jobs and ${allSteps.length} total steps.`,
    summary: `Imported from GitHub Actions workflow "${workflowName}" with ${Object.keys(jobsObj).length} jobs and ${allSteps.length} steps.`,
    suggested_connectors: connectors,
  };
}
