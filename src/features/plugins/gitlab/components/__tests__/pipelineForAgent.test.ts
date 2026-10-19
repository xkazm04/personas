import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { pipelineForAgent, slugifyPersonaName } from '../pipelineHelpers';

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

/**
 * The chip finds an agent's pipeline by the `persona/<slug>/...` ref the
 * backend writes; these cases compare the TS slug with Rust's `slugify_persona_name`.
 * Tethered: the expectations are read from the Rust unit test that pins the
 * backend slug, so a change on either side fails here.
 */
describe('slugifyPersonaName against the backend slug', () => {
  const rust = readFileSync(
    resolve(process.cwd(), 'src-tauri/src/commands/infrastructure/gitlab.rs'),
    'utf8',
  )
    .split('\n')
    .filter((l) => !l.trim().startsWith('//'))
    .join('\n');
  const cases = [...rust.matchAll(/slugify_persona_name\(\s*"([^"]*)"\s*\)\s*,\s*"([^"]*)"/g)].map(
    (m) => [m[1]!, m[2]!] as const,
  );

  it('found the Rust pins it mirrors', () => {
    expect(cases.length).toBeGreaterThanOrEqual(4);
  });

  it.each(cases)('slug(%j) === %j', (name, slug) => {
    expect(slugifyPersonaName(name)).toBe(slug);
  });

  it('gives a punctuated agent its own pipeline chip', () => {
    const rows = [pipe('persona/my-bot/production', 'success')];
    expect(pipelineForAgent(rows, 'My Bot!')?.status).toBe('success');
  });
});
