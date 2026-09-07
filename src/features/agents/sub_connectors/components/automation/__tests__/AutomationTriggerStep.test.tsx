import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AutomationTriggerStep } from '../AutomationTriggerStep';
import type { CredentialMetadata } from '@/lib/types/types';

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
      zapierZaps={[]} loadingZaps={false}
      availableUseCases={[]} useCaseId={null} setUseCaseId={() => {}}
      canDesign={false} onDesign={() => {}}
    />,
  );
}

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
