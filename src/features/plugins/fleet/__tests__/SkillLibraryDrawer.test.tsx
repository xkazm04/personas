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
  it('loads a clicked skill into the composer and applies the full command', async () => {
    const onApply = vi.fn();
    const user = userEvent.setup();
    render(<SkillLibraryDrawer open onClose={() => {}} onApply={onApply} targetLabel="repo-a" />);

    expect(screen.getByTestId('fleet-skills-drawer')).toBeInTheDocument();
    expect(screen.getByText('research')).toBeInTheDocument();
    expect(screen.getByText('code-review')).toBeInTheDocument();

    // Click loads `/research ` into the composer (does not apply yet).
    await user.click(screen.getByTestId('fleet-drawer-apply-research'));
    const composer = screen.getByTestId('fleet-drawer-command') as HTMLInputElement;
    expect(composer.value).toBe('/research ');
    expect(onApply).not.toHaveBeenCalled();

    // Add args, then send → full command applied (trimmed).
    await user.type(composer, 'deep dive');
    await user.click(screen.getByTestId('fleet-drawer-send'));
    expect(onApply).toHaveBeenCalledWith('/research deep dive');
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
