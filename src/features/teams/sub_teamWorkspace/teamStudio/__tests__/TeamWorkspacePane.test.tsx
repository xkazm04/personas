import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

(globalThis as Record<string, unknown>).__IPC_TOKEN = 'test-token';

const TEAM = {
  id: 't1',
  name: 'Core',
  description: 'Ships the core',
  color: '#6366f1',
  shared_instructions: 'Be terse.',
  // A profile the picker cannot represent exactly: a retired opus id.
  default_model_profile: '{"model":"claude-opus-4-8","provider":"anthropic"}',
  default_max_budget_usd: 2,
  default_max_turns: 10,
};
const fetchTeams = vi.fn().mockResolvedValue(undefined);
const storeState = { teams: [TEAM], fetchTeams, deleteTeam: vi.fn() };
vi.mock('@/stores/pipelineStore', () => ({
  usePipelineStore: (sel: (s: typeof storeState) => unknown) => sel(storeState),
}));
const addToast = vi.fn();
vi.mock('@/stores/toastStore', () => ({
  useToastStore: Object.assign(
    (sel: (s: { addToast: typeof addToast }) => unknown) => sel({ addToast }),
    { getState: () => ({ addToast }) },
  ),
}));
const updateTeam = vi.fn().mockResolvedValue(TEAM);
vi.mock('@/api/pipeline/teams', () => ({
  updateTeam: (...a: unknown[]) => updateTeam(...a),
}));
// Sibling sections own their own IPC; not under test here.
vi.mock('../slackBridge/TeamSlackBridgePanel', () => ({ TeamSlackBridgePanel: () => null }));
vi.mock('../PublishPresetButton', () => ({ PublishPresetButton: () => null }));
vi.mock('../ForkTeamButton', () => ({ ForkTeamButton: () => null }));

import en from '@/i18n/locales/en.json';
vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({ t: en, tx: (s: string) => s }),
}));

import { TeamWorkspacePane } from '../TeamWorkspacePane';

const saveButton = () => screen.getByText(en.pipeline.team_studio.workspace_save).closest('button') as HTMLButtonElement;
const inputs = () => screen.getAllByRole('textbox') as HTMLInputElement[];

describe('TeamWorkspacePane save', () => {
  beforeEach(() => {
    updateTeam.mockClear();
  });

  it('renaming the team does not rewrite the default model the user never touched', async () => {
    render(<TeamWorkspacePane teamId="t1" />);
    const name = inputs().find((i) => i.value === 'Core')!;
    fireEvent.change(name, { target: { value: 'Core Platform' } });
    fireEvent.click(saveButton());

    await waitFor(() => expect(updateTeam).toHaveBeenCalledTimes(1));
    const input = updateTeam.mock.calls[0]![1] as Record<string, unknown>;
    expect(input.name).toBe('Core Platform');
    expect(input).not.toHaveProperty('default_model_profile');
    expect(input).not.toHaveProperty('shared_instructions');
    expect(input).not.toHaveProperty('default_max_budget_usd');
    expect(input).not.toHaveProperty('default_max_turns');
  });

  it('clearing the description alone enables Save and clears it', async () => {
    render(<TeamWorkspacePane teamId="t1" />);
    expect(saveButton().disabled).toBe(true);
    const desc = inputs().find((i) => i.value === 'Ships the core')!;
    fireEvent.change(desc, { target: { value: '' } });

    expect(saveButton().disabled).toBe(false);
    fireEvent.click(saveButton());
    await waitFor(() => expect(updateTeam).toHaveBeenCalledTimes(1));
    expect((updateTeam.mock.calls[0]![1] as Record<string, unknown>).description).toBeNull();
  });
});
