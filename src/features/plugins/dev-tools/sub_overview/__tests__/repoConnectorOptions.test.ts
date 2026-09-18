import { describe, it, expect } from 'vitest';
import type { PersonaCredential } from '@/lib/bindings/PersonaCredential';

import { repoConnectorOptions } from '../useOverviewData';

function cred(id: string, name: string, serviceType: string, metadata: string | null = null): PersonaCredential {
  return { id, name, serviceType, metadata } as PersonaCredential;
}

const creds = [
  cred('gh1', 'Acme GitHub', 'github'),
  cred('gl1', 'Acme GitLab', 'gitlab'),
  cred('gl2', 'Self-hosted', 'api_key', JSON.stringify({ platform_type: 'gitlab' })),
  cred('s1', 'Sentry', 'sentry'),
];

describe('repoConnectorOptions', () => {
  it('offers GitLab credentials for a GitLab project', () => {
    const ids = repoConnectorOptions(creds, 'https://gitlab.com/acme/app').map((o) => o.id);
    expect(ids).toEqual(['gl1', 'gl2']);
  });

  it('still hides GitLab credentials from a GitHub project', () => {
    const ids = repoConnectorOptions(creds, 'https://github.com/acme/app').map((o) => o.id);
    expect(ids).toEqual(['gh1']);
  });

  it('offers both, provider-labelled, when the URL names no provider', () => {
    const opts = repoConnectorOptions(creds, null);
    expect(opts.map((o) => o.id)).toEqual(['gh1', 'gl1', 'gl2']);
    expect(opts.map((o) => o.name)).toEqual([
      'Acme GitHub (GitHub)',
      'Acme GitLab (GitLab)',
      'Self-hosted (GitLab)',
    ]);
  });

  it('never offers a credential that is neither provider', () => {
    for (const url of ['https://gitlab.com/a/b', 'https://github.com/a/b', '']) {
      expect(repoConnectorOptions(creds, url).map((o) => o.id)).not.toContain('s1');
    }
  });
});
