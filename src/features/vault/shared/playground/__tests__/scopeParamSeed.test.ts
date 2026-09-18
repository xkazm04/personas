import { describe, it, expect } from 'vitest';
import {
  seedPathParams,
  applyPathSeeds,
  isFullyResolved,
  queryParamDefault,
  unresolvedPathParams,
  type ScopedResources,
} from '../scopeParamSeed';
import { initQueryParams } from '../BuilderParams';
import { CATALOG_API_ENDPOINTS } from '@/lib/credentials/catalogApiEndpoints';

/**
 * The explorer's one-click surface vs. what the catalog actually ships.
 *
 * Before this, Run All skipped every `{param}` path with "Has path parameters"
 * -- which is 6 of GitHub's 8 catalog endpoints and 6 of Azure DevOps's 7 --
 * and Try opened those fields empty, even for a credential whose scope picker
 * had already recorded exactly which repo or project it is for.
 */

const githubScope: ScopedResources = {
  repositories: [{ id: 'xkazm04/personas', label: 'xkazm04/personas' }],
};

describe('seedPathParams', () => {
  it('splits a GitHub full_name pick into owner and repo', () => {
    expect(seedPathParams('/repos/{owner}/{repo}/issues', githubScope)).toEqual({
      owner: 'xkazm04',
      repo: 'personas',
    });
  });

  it('fills {project} from an Azure DevOps projects pick', () => {
    const scope: ScopedResources = { projects: [{ id: 'Contoso', label: 'Contoso' }] };
    expect(seedPathParams('/{project}/_apis/git/repositories', scope)).toEqual({ project: 'Contoso' });
  });

  it('leaves a param no recorded scope can answer alone', () => {
    const seeds = seedPathParams('/{project}/_apis/wit/workitems/{id}', {
      projects: [{ id: 'Contoso', label: 'Contoso' }],
    });
    expect(seeds).toEqual({ project: 'Contoso' });
    expect(isFullyResolved(applyPathSeeds('/{project}/_apis/wit/workitems/{id}', seeds))).toBe(false);
  });

  it('is inert without a scope, and for an id that is not owner/name', () => {
    expect(seedPathParams('/repos/{owner}/{repo}', null)).toEqual({});
    expect(seedPathParams('/repos/{owner}/{repo}', { repositories: [] })).toEqual({});
    // A single-segment id cannot be split; guessing would send a wrong request.
    expect(seedPathParams('/repos/{owner}/{repo}', { repositories: [{ id: 'personas', label: 'p' }] })).toEqual({});
  });
});

describe('queryParamDefault', () => {
  it('takes a bare literal from a required parameter', () => {
    expect(queryParamDefault({ required: true, description: '7.1' })).toBe('7.1');
  });

  it('never treats prose or an enumeration as a default', () => {
    expect(queryParamDefault({ required: false, description: 'open, closed, all' })).toBe('');
    expect(queryParamDefault({ required: true, description: 'Results per page (max 100)' })).toBe('');
    expect(queryParamDefault({ required: true, description: null })).toBe('');
  });
});

describe('the real catalog', () => {
  const azureListRepos = CATALOG_API_ENDPOINTS.azure_devops!
    .find((e) => e.path === '/{project}/_apis/git/repositories')!;

  it('hydrates api-version so the request is not rejected before it is sent', () => {
    const rows = initQueryParams(azureListRepos);
    expect(rows.find((r) => r.key === 'api-version')?.value).toBe('7.1');
  });

  it('resolves most of the GitHub slice from one repo pick', () => {
    const github = CATALOG_API_ENDPOINTS.github!;
    const stillBlocked = github.filter((ep) => unresolvedPathParams(ep, githubScope).length > 0);
    expect(stillBlocked).toEqual([]);
    // ... and nothing is resolvable without the scope.
    const blockedUnscoped = github.filter((ep) => unresolvedPathParams(ep, null).length > 0);
    expect(blockedUnscoped.length).toBeGreaterThan(0);
  });
});
