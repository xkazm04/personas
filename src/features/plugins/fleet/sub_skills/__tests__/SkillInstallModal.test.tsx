/**
 * Unit tests for SkillInstallModal (P1.2 cross-repo install).
 *
 * Store + toast are mocked at the module boundary; useTranslation is real.
 * We drive the modal via its testids and assert the onInstall contract +
 * the "already exists" → prime-overwrite behaviour.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { SkillInstallResult } from '@/lib/bindings/SkillInstallResult';

(globalThis as Record<string, unknown>).__IPC_TOKEN = 'test-token';

const PROJECTS = [
  { id: 'p1', name: 'repo-a', root_path: '/a' },
  { id: 'p2', name: 'repo-b', root_path: '/b' },
];

vi.mock('@/stores/systemStore', () => ({
  useSystemStore: (selector: (s: unknown) => unknown) =>
    selector({ projects: PROJECTS, fetchProjects: () => Promise.resolve() }),
}));

const addToast = vi.fn();
vi.mock('@/stores/toastStore', () => ({
  useToastStore: (selector: (s: unknown) => unknown) => selector({ addToast }),
}));

import { SkillInstallModal } from '../SkillInstallModal';

const ok: SkillInstallResult = { installed: true, targetPath: '/b/.claude/skills/research', fileCount: 3, reason: null };
const exists: SkillInstallResult = { installed: false, targetPath: '/b/.claude/skills/research', fileCount: 0, reason: 'exists' };

describe('SkillInstallModal', () => {
  beforeEach(() => addToast.mockClear());

  it('installs the skill into the picked project (overwrite=false) and closes on success', async () => {
    const onInstall = vi.fn().mockResolvedValue(ok);
    const onClose = vi.fn();
    const user = userEvent.setup();

    render(<SkillInstallModal open skillName="research" onClose={onClose} onInstall={onInstall} />);

    await user.click(screen.getByTestId('skill-install-target-p2'));
    await user.click(screen.getByTestId('skill-install-confirm'));

    await waitFor(() => expect(onInstall).toHaveBeenCalledWith('p2', false));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(addToast).toHaveBeenCalledWith(expect.stringContaining('research'), 'success');
  });

  it('on "exists" keeps the modal open and primes the overwrite toggle', async () => {
    const onInstall = vi.fn().mockResolvedValue(exists);
    const onClose = vi.fn();
    const user = userEvent.setup();

    render(<SkillInstallModal open skillName="research" onClose={onClose} onInstall={onInstall} />);

    await user.click(screen.getByTestId('skill-install-target-p1'));
    await user.click(screen.getByTestId('skill-install-confirm'));

    await waitFor(() => expect(onInstall).toHaveBeenCalledWith('p1', false));
    expect(onClose).not.toHaveBeenCalled();
    // Overwrite checkbox is now primed for a confirming second click.
    await waitFor(() => expect(screen.getByRole('checkbox')).toBeChecked());
    expect(addToast).toHaveBeenCalledWith(expect.stringContaining('already exists'), 'warning');
  });
});
