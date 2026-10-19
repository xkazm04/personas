import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

// Bypass the 2s IPC-token wait in tests.
(globalThis as Record<string, unknown>).__IPC_TOKEN = 'test-token';

// Mock the skill files API surface used by useSkillData.
vi.mock('@/api/devTools/devTools', () => ({
  listSkills: vi.fn(),
  listSkillsGlobal: vi.fn(),
  installSkill: vi.fn(),
}));

// Avoid pulling the toast store's full module graph.
// toastCatch writes through getState(), the hook through a selector: carry both.
const addToast = vi.fn();
vi.mock('@/stores/toastStore', () => ({
  useToastStore: Object.assign(
    (selector: (s: { addToast: typeof addToast }) => unknown) => selector({ addToast }),
    { getState: () => ({ addToast }) },
  ),
}));

// useSkillData now subscribes to activeProjectId so it can scope skill
// lookups to the user's selected dev-tools project. Minimal stub returns
// null (no project selected).
vi.mock('@/stores/systemStore', () => ({
  useSystemStore: (selector: (s: { activeProjectId: string | null }) => unknown) =>
    selector({ activeProjectId: null }),
}));

// useTranslation calls go through the i18n Proxy; for unit tests the dt
// strings only matter when an error path fires. Stub minimally.
vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({
    t: { plugins: { dev_tools: {}, fleet: { skill_install_failed: 'Install failed' } } },
    tx: (s: string) => s,
  }),
}));

import { useSkillData } from '../useSkillData';
import * as devApi from '@/api/devTools/devTools';

const SKILLS = [
  { name: 'research', path: '/skills/research', description: 'Research skill', referenceFileCount: 0, referenceFiles: [] },
  { name: 'add-template', path: '/skills/add-template', description: 'Templates', referenceFileCount: 0, referenceFiles: [] },
  { name: 'friend', path: '/skills/friend', description: 'Endless loop', referenceFileCount: 0, referenceFiles: [] },
];

describe('useSkillData — favorites', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(devApi.listSkills).mockResolvedValue(SKILLS);
  });

  it('starts with no favorites when storage is empty', async () => {
    const { result } = renderHook(() => useSkillData());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.filtered).toHaveLength(3);
    expect(result.current.isFavorite('research')).toBe(false);
  });

  it('toggleFavorite flips the favorite state and persists to localStorage', async () => {
    const { result } = renderHook(() => useSkillData());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.toggleFavorite('friend'));
    expect(result.current.isFavorite('friend')).toBe(true);
    expect(JSON.parse(localStorage.getItem('personas.devtools.skill_favorites')!)).toContain('friend');

    act(() => result.current.toggleFavorite('friend'));
    expect(result.current.isFavorite('friend')).toBe(false);
    expect(JSON.parse(localStorage.getItem('personas.devtools.skill_favorites')!)).not.toContain('friend');
  });

  it('rehydrates favorites from localStorage on mount', async () => {
    localStorage.setItem('personas.devtools.skill_favorites', JSON.stringify(['research', 'friend']));
    const { result } = renderHook(() => useSkillData());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.isFavorite('research')).toBe(true);
    expect(result.current.isFavorite('friend')).toBe(true);
    expect(result.current.isFavorite('add-template')).toBe(false);
  });

  it('sorts favorites before non-favorites in the filtered list', async () => {
    localStorage.setItem('personas.devtools.skill_favorites', JSON.stringify(['friend']));
    const { result } = renderHook(() => useSkillData());
    await waitFor(() => expect(result.current.loading).toBe(false));
    // Favorite 'friend' should land at index 0 even though the source order is research/add-template/friend.
    expect(result.current.filtered[0]!.name).toBe('friend');
  });

  it('treats corrupted localStorage as empty without crashing', async () => {
    localStorage.setItem('personas.devtools.skill_favorites', '{not json');
    const { result } = renderHook(() => useSkillData());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.isFavorite('research')).toBe(false);
  });
});

describe('useSkillData — install failure', () => {
  beforeEach(() => {
    localStorage.clear();
    addToast.mockClear();
    vi.mocked(devApi.listSkills).mockResolvedValue(SKILLS);
    vi.mocked(devApi.listSkillsGlobal).mockResolvedValue(SKILLS);
  });

  it('toasts the translated sentence, never the raw OS error', async () => {
    vi.mocked(devApi.installSkill).mockRejectedValue(new Error('EACCES: permission denied, mkdir /b/.claude/skills'));
    const { result } = renderHook(() => useSkillData('global'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    let out: unknown = 'unset';
    await act(async () => { out = await result.current.installSkill('research', 'p2', false); });
    expect(out).toBeNull();
    expect(addToast).toHaveBeenCalledWith('Install failed', 'error', expect.any(Number));
    expect(addToast.mock.calls.flat().join(' ')).not.toContain('EACCES');
  });

  it('handles the AppError object the IPC actually rejects with', async () => {
    vi.mocked(devApi.installSkill).mockRejectedValue({ error: 'target project has no root', kind: 'NotFound' });
    const { result } = renderHook(() => useSkillData('global'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => { await result.current.installSkill('research', 'p2', false); });
    expect(addToast.mock.calls.at(-1)?.slice(0, 2)).toEqual(['Install failed', 'error']);
    expect(addToast.mock.calls.flat().join(' ')).not.toContain('[object Object]');
  });
});

describe('useSkillData — source switch', () => {
  it('keeps the selected source list when the previous source answers late', async () => {
    localStorage.clear();
    let resolveProject: (v: typeof SKILLS) => void = () => {};
    vi.mocked(devApi.listSkills).mockImplementation(() => new Promise((r) => { resolveProject = r; }));
    vi.mocked(devApi.listSkillsGlobal).mockResolvedValue([SKILLS[2]!]);
    const { result } = renderHook(() => useSkillData('project'));

    act(() => result.current.setSource('global'));
    await waitFor(() => expect(result.current.filtered.map((s) => s.name)).toEqual(['friend']));

    await act(async () => { resolveProject(SKILLS); });
    expect(result.current.filtered.map((s) => s.name)).toEqual(['friend']);
    expect(result.current.loading).toBe(false);
  });
});
