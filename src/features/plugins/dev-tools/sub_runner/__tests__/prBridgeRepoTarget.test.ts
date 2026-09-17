import { describe, it, expect } from 'vitest';

import { buildRepoFormUrl, parseRepoTarget } from '../PrBridge';

describe('parseRepoTarget', () => {
  it('recognises a GitLab project instead of dead-ending on unsupported host', () => {
    expect(parseRepoTarget('https://gitlab.com/acme/app')).toEqual({
      provider: 'gitlab',
      baseUrl: 'https://gitlab.com/acme/app',
    });
  });

  it('recognises a self-hosted GitLab instance', () => {
    expect(parseRepoTarget('https://gitlab.acme.dev/team/app.git/')).toEqual({
      provider: 'gitlab',
      baseUrl: 'https://gitlab.acme.dev/team/app',
    });
  });

  it('still parses GitHub first, in both URL shapes', () => {
    expect(parseRepoTarget('https://github.com/acme/app')).toEqual({
      provider: 'github', owner: 'acme', repo: 'app',
    });
    expect(parseRepoTarget('git@github.com:acme/app.git')).toEqual({
      provider: 'github', owner: 'acme', repo: 'app',
    });
  });

  it('leaves an unknown host, an SSH-only GitLab remote and an empty URL unrecognised', () => {
    expect(parseRepoTarget('https://bitbucket.org/acme/app')).toBeNull();
    expect(parseRepoTarget('git@gitlab.com:acme/app.git')).toBeNull();
    expect(parseRepoTarget(null)).toBeNull();
  });
});

describe('buildRepoFormUrl', () => {
  it('opens GitLab new-merge-request pre-filled from the branch', () => {
    const url = buildRepoFormUrl(
      { provider: 'gitlab', baseUrl: 'https://gitlab.com/acme/app' },
      'devtools/fix-lint',
      'Fix lint',
      'body text',
    );
    expect(url.startsWith('https://gitlab.com/acme/app/-/merge_requests/new?')).toBe(true);
    const params = new URLSearchParams(url.split('?')[1]);
    expect(params.get('merge_request[source_branch]')).toBe('devtools/fix-lint');
    expect(params.get('merge_request[title]')).toBe('Fix lint');
    expect(params.get('merge_request[description]')).toBe('body text');
  });

  it('keeps the GitHub quick_pull compare URL unchanged', () => {
    const url = buildRepoFormUrl(
      { provider: 'github', owner: 'acme', repo: 'app' },
      'devtools/fix-lint',
      'Fix lint',
      'body text',
    );
    expect(url.startsWith('https://github.com/acme/app/pull/new/devtools%2Ffix-lint?')).toBe(true);
    const params = new URLSearchParams(url.split('?')[1]);
    expect(params.get('quick_pull')).toBe('1');
    expect(params.get('title')).toBe('Fix lint');
  });
});
