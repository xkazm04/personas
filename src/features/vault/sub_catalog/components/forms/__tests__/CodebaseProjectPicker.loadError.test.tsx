import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// listProjects goes through invokeWithTimeout, which rejects with a serialized
// AppError OBJECT, never an Error.
vi.mock('@/api/devTools/devTools', () => ({
  listProjects: vi.fn(() => Promise.reject({ error: 'database is locked', kind: 'Database' })),
}));

vi.mock('@/i18n/useTranslatedError', () => ({
  resolveErrorTranslated: (_t: unknown, raw: string | null) => ({ message: `resolved:${raw ?? 'generic'}` }),
}));

const { CodebaseProjectPicker } = await import('../CodebaseProjectPicker');

describe('CodebaseProjectPicker load failure', () => {
  it('shows the resolved backend reason, not "[object Object]"', async () => {
    render(<CodebaseProjectPicker onSave={() => {}} onCancel={() => {}} />);
    expect(await screen.findByText('resolved:database is locked')).toBeTruthy();
    expect(screen.queryByText('[object Object]')).toBeNull();
  });
});
