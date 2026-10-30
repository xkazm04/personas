import { describe, it, expect, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AutomationTriggerStep } from '../AutomationTriggerStep';
import type { CredentialMetadata } from '@/lib/types/types';
import { preloadSectionsAsync } from '@/i18n/useTranslation';

beforeAll(() => preloadSectionsAsync('en', ['vault', 'agents', 'overview']));

// Only `id` and `name` are read by the banner; the rest of the shape is
// irrelevant to what this test pins.
const cred = (id: string, name: string) => ({ id, name, service_type: 'n8n', serviceType: 'n8n' } as unknown as CredentialMetadata);

function renderStep(selectedId: string | null) {
  const creds = [cred('cred-first', 'Workspace A'), cred('cred-second', 'Workspace B')];
  return render(
    <AutomationTriggerStep
      description="" setDescription={() => {}}
      platform="n8n" setPlatform={() => {}}
      editAutomation={null}
      needsCredential hasPlatformCredential
      platformCredentials={creds}
      platformCredentialId={selectedId} setPlatformCredentialId={() => {}}
      platformConnector={null}
      githubRepos={[]} githubPerms={null} githubRepo={null} setGithubRepo={() => {}} loadingRepos={false}
      zapierZaps={[]} loadingZaps={false} reposFailed={false} zapsFailed={false} onRetryListings={() => {}}
      availableUseCases={[]} useCaseId={null} setUseCaseId={() => {}}
      canDesign={false} onDesign={() => {}}
    />,
  );
}

describe('AutomationTriggerStep platform listings (card 24)', () => {
  function renderListing(platform: 'github_actions' | 'zapier', failed: boolean) {
    const ghCred = { id: 'c1', name: 'Work', service_type: platform } as unknown as CredentialMetadata;
    return render(
      <AutomationTriggerStep
        description="x" setDescription={() => {}}
        platform={platform} setPlatform={() => {}}
        editAutomation={null}
        needsCredential hasPlatformCredential
        platformCredentials={[ghCred]}
        platformCredentialId="c1" setPlatformCredentialId={() => {}}
        platformConnector={null}
        githubRepos={[]} githubPerms={null} githubRepo={null} setGithubRepo={() => {}} loadingRepos={false}
        zapierZaps={[]} loadingZaps={false} reposFailed={failed} zapsFailed={failed} onRetryListings={() => {}}
        availableUseCases={[]} useCaseId={null} setUseCaseId={() => {}}
        canDesign={false} onDesign={() => {}}
      />,
    );
  }

  it('a failed repo listing says it failed, not "No repositories found"', () => {
    renderListing('github_actions', true);
    expect(screen.getByRole('alert').textContent).toMatch(/Couldn't load your repositories/);
    expect(screen.queryByText(/No repositories found/)).toBeNull();
  });

  it('an empty repo listing still shows the empty copy', () => {
    renderListing('github_actions', false);
    expect(screen.getByText(/No repositories found/)).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('a failed zap listing says it failed, not "A new Zap will be created"', () => {
    renderListing('zapier', true);
    expect(screen.getByRole('alert').textContent).toMatch(/Couldn't load your Zaps/);
    expect(screen.queryByText(/No existing Zaps found/)).toBeNull();
  });

  it('card 26: the scope warning reads both scopes through the catalog', () => {
    const ghCred = { id: 'c1', name: 'Work', service_type: 'github_actions' } as unknown as CredentialMetadata;
    render(
      <AutomationTriggerStep
        description="x" setDescription={() => {}} platform="github_actions" setPlatform={() => {}}
        editAutomation={null} needsCredential hasPlatformCredential platformCredentials={[ghCred]}
        platformCredentialId="c1" setPlatformCredentialId={() => {}} platformConnector={null}
        githubRepos={[]} githubPerms={{ hasRepo: false, hasWorkflow: false } as never} githubRepo={null} setGithubRepo={() => {}} loadingRepos={false}
        zapierZaps={[]} loadingZaps={false} reposFailed={false} zapsFailed={false} onRetryListings={() => {}}
        availableUseCases={[]} useCaseId={null} setUseCaseId={() => {}} canDesign={false} onDesign={() => {}}
      />,
    );
    expect(screen.getByText(/Your token needs 'repo' and 'workflow' scope/)).toBeTruthy();
  });
});

describe('AutomationTriggerStep connected-credential banner', () => {
  it('names the SELECTED credential, not the first one offered', () => {
    renderStep('cred-second');
    // The banner is the only place the name appears as plain text; the
    // <select> lists both, so scope the assertion to non-option nodes.
    const banners = screen.getAllByText('Workspace B').filter((el) => el.tagName !== 'OPTION');
    expect(banners).toHaveLength(1);
    expect(screen.getAllByText('Workspace A').filter((el) => el.tagName !== 'OPTION')).toHaveLength(0);
  });

  it('renders an explicit absence, never the first credential, when the selection is gone', () => {
    // The hook re-selects a valid id within one effect tick; in that frame,
    // and for a dangling id, the banner must not claim a credential it will
    // not deploy with.
    renderStep('cred-gone');
    expect(screen.getAllByText('Workspace A').filter((el) => el.tagName !== 'OPTION')).toHaveLength(0);
    expect(screen.getAllByText('Workspace B').filter((el) => el.tagName !== 'OPTION')).toHaveLength(0);
  });
});
