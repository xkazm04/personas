/**
 * Card 19: the leading tile was success-green for every status.
 * Card 25: a linked card offered no way to point the slot at a sibling credential.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { preloadSectionsAsync } from '@/i18n/useTranslation';
import type { ConnectorStatus } from '../../../libs/connectorTypes';
import type { CredentialMetadata } from '@/lib/types/types';
import { ConnectorStatusCard } from '../ConnectorStatusCard';

beforeAll(() => preloadSectionsAsync('en', ['vault', 'agents', 'overview']));

const cred = (id: string) => ({ id, name: id, service_type: 'github' } as unknown as CredentialMetadata);

function renderCard(status: Partial<ConnectorStatus>, credentials: CredentialMetadata[]) {
  const onToggleLinking = vi.fn();
  render(
    <ConnectorStatusCard
      status={{ name: 'github', credentialId: null, credentialName: null, testing: false, result: null, linkError: null, ...status }}
      isLinking={false} credentials={credentials}
      onTest={() => {}} onToggleLinking={onToggleLinking} onLinkCredential={() => {}} onAddCredential={() => {}}
    />,
  );
  return { onToggleLinking };
}

describe('ConnectorStatusCard', () => {
  it('19: the tile follows the status (missing credential is not success-green)', () => {
    renderCard({}, []);
    const tile = screen.getByTestId('connector-status-tile');
    expect(tile.className).toContain('bg-amber-500/10');
    expect(tile.className).not.toContain('emerald');
  });

  it('25: a linked card with a sibling credential offers Change, which opens the picker', () => {
    const { onToggleLinking } = renderCard({ credentialId: 'cred-new', credentialName: 'cred-new' }, [cred('cred-new'), cred('cred-old')]);
    fireEvent.click(screen.getByRole('button', { name: 'Change' }));
    expect(onToggleLinking).toHaveBeenCalledWith('github');
  });

  it('25: no Change control when the linked credential is the only one', () => {
    renderCard({ credentialId: 'cred-new', credentialName: 'cred-new' }, [cred('cred-new')]);
    expect(screen.queryByRole('button', { name: 'Change' })).toBeNull();
  });
});
