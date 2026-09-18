import { describe, expect, it } from 'vitest';
import { pipelineForAgent } from '../pipelineHelpers';

/**
 * Sweep #384 — every Duo agent row rendered `pipelines[0]`, the project's latest
 * pipeline, so a red chip on agent B was routinely agent A's build, sitting
 * right next to B's Redeploy and Undeploy buttons.
 */

const pipe = (ref: string, status = 'failed') => ({ ref, status });

describe('pipelineForAgent', () => {
  it('attributes a persona/<agent>/<env> ref to that agent', () => {
    const rows = [pipe('persona/deploy-bot/production'), pipe('persona/review-bot/staging', 'success')];
    expect(pipelineForAgent(rows, 'deploy-bot')?.status).toBe('failed');
    expect(pipelineForAgent(rows, 'review-bot')?.status).toBe('success');
  });

  it('gives an agent with no pipeline of its own NO chip, not a sibling one', () => {
    const rows = [pipe('persona/deploy-bot/production')];
    expect(pipelineForAgent(rows, 'review-bot')).toBeNull();
  });

  it('does not attribute a main-branch pipeline to any agent', () => {
    expect(pipelineForAgent([pipe('main')], 'deploy-bot')).toBeNull();
  });

  it('takes the freshest match when an agent has several', () => {
    const rows = [
      pipe('persona/deploy-bot/production', 'running'),
      pipe('persona/deploy-bot/staging', 'success'),
    ];
    expect(pipelineForAgent(rows, 'deploy-bot')?.status).toBe('running');
  });

  it('matches case-insensitively and treats spaces as the branch-safe dash', () => {
    const rows = [pipe('persona/deploy-bot/production', 'success')];
    expect(pipelineForAgent(rows, 'Deploy Bot')?.status).toBe('success');
  });

  it('never matches on an empty agent name', () => {
    expect(pipelineForAgent([pipe('persona/deploy-bot/production')], '   ')).toBeNull();
  });
});
