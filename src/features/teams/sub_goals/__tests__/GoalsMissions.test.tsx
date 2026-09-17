import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { TeamAssignment } from '@/lib/bindings/TeamAssignment';

// Bypass IPC token wait.
(globalThis as Record<string, unknown>).__IPC_TOKEN = 'test-token';

/** The case the whole view exists for: the Assign flow writes goalId: null. */
const adhoc = {
  id: 'a1',
  teamId: 't1',
  goalId: null,
  title: 'Advance: ship the loader',
  status: 'running',
  createdAt: '2026-09-17 10:00:00',
} as unknown as TeamAssignment;

const fetchTeams = vi.fn().mockResolvedValue(undefined);
const fetchTeamAssignments = vi.fn().mockResolvedValue(undefined);

vi.mock('@/stores/pipelineStore', () => ({
  usePipelineStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      teams: [{ id: 't1', name: 'SDLC — Core' }],
      fetchTeams,
      assignmentsByTeam: { t1: [adhoc] },
      fetchTeamAssignments,
      pauseAssignment: vi.fn(),
      resumeAssignment: vi.fn(),
    }),
}));

vi.mock('@/stores/systemStore', () => ({
  useSystemStore: (selector: (s: Record<string, unknown>) => unknown) => selector({ goals: [] }),
}));

// The real catalogue rather than a hand-written fixture: this view reads two
// distant sections (pipeline.team_studio, plugins.dev_lifecycle) and a stub
// would drift from en.json the first time a key moved.
import en from '@/i18n/locales/en.json';
vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({ t: en, tx: (s: string) => s }),
}));

// Live-step polling, replay and learning are separate surfaces with their own
// IPC; this test is about whether a goal-less mission is reachable at all.
vi.mock('@/features/teams/sub_teamWorkspace/teamStudio/boardShared', () => ({
  GoalChip: () => null,
  PersonaStack: () => null,
  StepProgressStrip: () => null,
  StepRelay: () => null,
  isLiveAssignmentStatus: () => false,
  stepMeta: () => ({ label: '', tone: '' }),
  useAssignmentSteps: () => ({ steps: [], loaded: true, refresh: vi.fn() }),
  usePersonaIndex: () => new Map(),
}));
vi.mock('@/features/teams/sub_teamWorkspace/teamStudio/AssignmentReplay', () => ({
  AssignmentReplay: () => null,
}));
vi.mock('@/features/teams/sub_assignments/MissionLearning', () => ({
  MissionLearning: () => null,
}));
vi.mock('@/api/pipeline/assignments', () => ({ setTeamAssignmentGoal: vi.fn() }));

import { GoalsMissions } from '../GoalsMissions';

describe('GoalsMissions as the Goals hub missions tab', () => {
  it('lists an assignment whose goalId is null', async () => {
    render(<GoalsMissions />);
    await waitFor(() => expect(screen.getByTestId('goals-missions')).toBeTruthy());
    const rows = screen.getAllByTestId('mission-row');
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain('ship the loader');
  });
});
