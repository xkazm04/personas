import { describe, it, expect } from 'vitest';
import { parseGithubActionsWorkflow } from '../githubActionsParser';

const nightly = {
  name: 'Nightly',
  on: {
    schedule: [{ cron: '0 3 * * *' }, { cron: '30 15 * * 1' }],
    workflow_dispatch: null,
  },
  jobs: {
    build: {
      'runs-on': 'ubuntu-latest',
      steps: [
        { name: 'Checkout', uses: 'actions/checkout@v4' },
        { name: 'Notify', uses: 'slackapi/slack-github-action@v1' },
      ],
    },
  },
};

describe('parseGithubActionsWorkflow — triggers', () => {
  it('carries schedule cron expressions into the description and config', () => {
    const result = parseGithubActionsWorkflow(nightly);
    const schedule = result.suggested_triggers!.find((t) => t.trigger_type === 'schedule')!;

    expect(schedule.description).toBe('Scheduled: 0 3 * * *, 30 15 * * 1');
    expect(schedule.config).toEqual({ cron: [{ cron: '0 3 * * *' }, { cron: '30 15 * * 1' }] });
  });

  it('maps workflow_dispatch to a manual trigger', () => {
    const result = parseGithubActionsWorkflow(nightly);
    expect(result.suggested_triggers!.some((t) => t.trigger_type === 'manual')).toBe(true);
  });

  it('accepts the YAML `on:`-parsed-as-`true:` key', () => {
    const result = parseGithubActionsWorkflow({
      name: 'Legacy',
      true: { schedule: [{ cron: '5 0 * * *' }] },
      jobs: { build: { steps: [{ run: 'echo hi' }] } },
    });
    expect(result.suggested_triggers![0]!.description).toBe('Scheduled: 5 0 * * *');
  });

  it('falls back to a manual trigger when no `on` block is present', () => {
    const result = parseGithubActionsWorkflow({
      name: 'No triggers',
      jobs: { build: { steps: [{ run: 'echo hi' }] } },
    });
    expect(result.suggested_triggers).toEqual([
      { trigger_type: 'manual', config: {}, description: 'Manual trigger (no trigger detected)' },
    ]);
  });

  it('rejects a workflow with no jobs', () => {
    expect(() => parseGithubActionsWorkflow({ name: 'Empty', on: 'push' })).toThrow(/no jobs found/);
  });
});
