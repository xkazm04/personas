/**
 * Unit tests for SkillLibraryDrawer (F1 surfacing). useSkillData + the install
 * modal are mocked at the module boundary; useTranslation is real. Verifies the
 * apply-to-terminal contract and the no-target disabled state.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

(globalThis as Record<string, unknown>).__IPC_TOKEN = 'test-token';

const MOCK_DATA = {
  filtered: [
    { name: 'research', description: 'Deep research', path: '', referenceFileCount: 0, referenceFiles: [] },
    { name: 'code-review', description: null, path: '', referenceFileCount: 0, referenceFiles: [] },
  ],
  loading: false,
  search: '',
  setSearch: vi.fn(),
  source: 'global' as const,
  setSource: vi.fn(),
  fetchSkills: vi.fn(),
  installSkill: vi.fn(),
};

vi.mock('../sub_skills/useSkillData', () => ({ useSkillData: () => MOCK_DATA }));
vi.mock('../sub_skills/SkillInstallModal', () => ({ SkillInstallModal: () => null }));

import { SkillLibraryDrawer } from '../SkillLibraryDrawer';

describe('SkillLibraryDrawer', () => {
  it('lists library skills and applies one to the focused terminal', async () => {
    const onApply = vi.fn();
    const user = userEvent.setup();
    render(<SkillLibraryDrawer open onClose={() => {}} onApply={onApply} targetLabel="repo-a" />);

    expect(screen.getByTestId('fleet-skills-drawer')).toBeInTheDocument();
    expect(screen.getByText('research')).toBeInTheDocument();
    expect(screen.getByText('code-review')).toBeInTheDocument();

    await user.click(screen.getByTestId('fleet-drawer-apply-research'));
    expect(onApply).toHaveBeenCalledWith('research');
  });

  it('disables apply when no session is focused', () => {
    const onApply = vi.fn();
    render(<SkillLibraryDrawer open onClose={() => {}} onApply={onApply} targetLabel={null} />);
    expect(screen.getByTestId('fleet-drawer-apply-research')).toBeDisabled();
  });

  it('renders nothing when closed', () => {
    const { container } = render(<SkillLibraryDrawer open={false} onClose={() => {}} onApply={() => {}} targetLabel="x" />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByTestId('fleet-skills-drawer')).not.toBeInTheDocument();
  });
});
