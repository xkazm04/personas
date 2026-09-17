/**
 * Unit tests for SkillLibraryDrawer (F1 surfacing). useSkillData + the install
 * modal are mocked at the module boundary; useTranslation is real. Verifies the
 * apply-to-terminal contract and the no-target disabled state.
 */
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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

// Only the PTY write is stubbed; everything else in the fleet API is left real
// so the drawer's other imports keep their actual shapes.
const writeInput = vi.fn();
vi.mock('@/api/fleet/fleet', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  writeInput: (...a: unknown[]) => writeInput(...a),
}));

import { useSystemStore } from '@/stores/systemStore';
import type { FleetSession } from '@/lib/bindings/FleetSession';
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

/**
 * Fan-out to every waiting session.
 *
 * The drawer's original contract was one command to the ONE focused session,
 * so a morning of five blocked agents was five trips through it. What the
 * cases below pin is not "writeInput was called" but WHICH ids it was called
 * with: only `awaiting_input` sessions, and — after a partial failure — only
 * the ones the first pass missed, because a retry that re-sends to sessions
 * that already ran the skill is worse than no retry.
 */
function session(id: string, state: string): FleetSession {
  return { id, state, name: id, projectLabel: id } as unknown as FleetSession;
}

describe('SkillLibraryDrawer — apply to waiting sessions', () => {
  beforeEach(() => {
    writeInput.mockReset();
    writeInput.mockResolvedValue(undefined);
    useSystemStore.setState({
      fleetSessions: [
        session('s1', 'awaiting_input'),
        session('s2', 'running'),
        session('s3', 'awaiting_input'),
        session('s4', 'awaiting_input'),
        session('s5', 'exited'),
      ],
    });
  });

  afterEach(() => {
    useSystemStore.setState({ fleetSessions: [] });
  });

  it('writes the command to every awaiting session and nothing else', async () => {
    const user = userEvent.setup();
    render(<SkillLibraryDrawer open onClose={() => {}} onApply={vi.fn()} targetLabel="repo-a" />);

    const button = screen.getByTestId('fleet-drawer-apply-waiting');
    expect(button).toHaveTextContent('3');
    // Nothing to send yet.
    expect(button).toBeDisabled();

    await user.type(screen.getByTestId('fleet-drawer-command'), '/compact');
    await user.click(button);

    await waitFor(() => expect(writeInput).toHaveBeenCalledTimes(3));
    expect(writeInput.mock.calls.map((c) => c[0]).sort()).toEqual(['s1', 's3', 's4']);
    // The carriage return is what submits it in the receiving terminal.
    expect(writeInput.mock.calls[0][1]).toBe('/compact' + String.fromCharCode(13));
  });

  it('retargets only the sessions it missed', async () => {
    writeInput.mockImplementation(async (id: string) => {
      if (id === 's3') throw new Error('session writer dropped');
    });
    const user = userEvent.setup();
    render(<SkillLibraryDrawer open onClose={() => {}} onApply={vi.fn()} targetLabel="repo-a" />);

    await user.type(screen.getByTestId('fleet-drawer-command'), '/compact');
    await user.click(screen.getByTestId('fleet-drawer-apply-waiting'));

    await waitFor(() => expect(writeInput).toHaveBeenCalledTimes(3));
    // The command stays in the composer so the retry is one click, not a retype.
    expect((screen.getByTestId('fleet-drawer-command') as HTMLInputElement).value).toBe('/compact');

    writeInput.mockReset();
    writeInput.mockResolvedValue(undefined);
    const retry = screen.getByTestId('fleet-drawer-apply-waiting');
    expect(retry).toHaveTextContent('1');
    await user.click(retry);

    await waitFor(() => expect(writeInput).toHaveBeenCalledTimes(1));
    expect(writeInput.mock.calls[0][0]).toBe('s3');
  });

  it('stays disabled when nothing is waiting', async () => {
    useSystemStore.setState({ fleetSessions: [session('s2', 'running')] });
    const user = userEvent.setup();
    render(<SkillLibraryDrawer open onClose={() => {}} onApply={vi.fn()} targetLabel="repo-a" />);

    await user.type(screen.getByTestId('fleet-drawer-command'), '/compact');
    expect(screen.getByTestId('fleet-drawer-apply-waiting')).toBeDisabled();
  });
});
