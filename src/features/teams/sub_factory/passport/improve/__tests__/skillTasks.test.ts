// The share prompt is a CONTRACT with whatever agent runs it, and the two
// destinations have different contracts. These assertions exist because the
// failure mode is silent: a prompt that forgets "do not push" still produces a
// plausible-looking run, and nobody notices until a branch is on the remote.

import { describe, expect, it } from 'vitest';

import type { DevProject } from '@/lib/bindings/DevProject';

import { shareBranchName, shareTaskPrompt } from '../skillTasks';

const project = { name: 'personas', root_path: 'C:/repo' } as unknown as DevProject;

const REGISTRY = {
  kind: 'registry' as const,
  clonePath: 'C:/Users/x/ai-registry',
  registryName: 'xkazm04/ai-registry',
};

describe('shareTaskPrompt — home (pre-registry behaviour)', () => {
  const p = shareTaskPrompt('perfect', project);

  it('targets the user-global library', () => {
    expect(p).toContain('~/.claude/skills/perfect/');
  });

  it('uses the personas category vocabulary, not the registry one', () => {
    expect(p).toContain('Development, Testing, Maintenance, Data, Other');
    expect(p).not.toContain('ci-cd');
  });

  // The home prompt DOES talk about git — `reflectionStep` carries a version
  // bump + LESSONS.md + "commit on the current branch" ritual for the SOURCE
  // repo. (An earlier version of this test asserted the prompt never mentions
  // branches; it does, and the test was wrong rather than the prompt.) What the
  // home path has no concept of is a DEDICATED branch in a separate repo,
  // because its destination is a plain directory.
  it('creates no dedicated branch — its destination is a directory, not a repo', () => {
    expect(p).not.toContain('skill/perfect');
    expect(p).not.toContain('NEVER commit to the default branch');
  });
});

describe('shareTaskPrompt — registry', () => {
  const p = shareTaskPrompt('perfect', project, REGISTRY);

  it('writes into the registry working copy, not the home library', () => {
    expect(p).toContain(`${REGISTRY.clonePath}/skills/perfect/`);
    expect(p).not.toContain('~/.claude/skills');
  });

  it('lands on a branch and refuses the default branch', () => {
    expect(p).toContain(shareBranchName('perfect'));
    expect(p).toContain('NEVER commit to the default branch');
  });

  it('stops at the commit — pushing would adopt on the human\u2019s behalf', () => {
    expect(p).toContain('Do NOT push');
    expect(p).toMatch(/do NOT open a pull request/i);
  });

  it('uses the REGISTRY closed category set', () => {
    expect(p).toContain('ci-cd, testing, security, ai-native, docs, workflow, other');
    // The personas vocabulary must not leak: it normalizes to `other` at index
    // time, which loses the categorisation without reporting anything.
    expect(p).not.toContain('Maintenance');
  });

  it('demands semver, spelling out the two-part case', () => {
    expect(p).toContain('version: X.Y.Z');
    expect(p).toContain('1.4.0');
  });

  it('protects the rest of the working copy, including other consumers', () => {
    expect(p).toContain('not the root registry.yaml');
    expect(p).toMatch(/another consumer\u2019s overlay/);
    expect(p).toContain('STOP and report');
  });

  it('leaves the source repo read-only', () => {
    expect(p).toMatch(/Do NOT touch this repo \(personas\)/);
  });
});

describe('shareBranchName', () => {
  it('namespaces by skill so two shares do not collide', () => {
    expect(shareBranchName('perfect')).toBe('skill/perfect');
    expect(shareBranchName('uat')).toBe('skill/uat');
  });
});
