import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrainViewer, __resetBrainListCacheForTests } from '../BrainViewer';
import { useAthenaStore } from '../athenaStore';
import type { BrainListItem } from '@/api/companion';

const api = vi.hoisted(() => ({ list: vi.fn(), counts: vi.fn() }));

vi.mock('@/api/companion', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/companion')>();
  return {
    ...actual,
    companionListBrainItems: api.list,
    companionCountBrainItems: api.counts,
  };
});

function item(id: string): BrainListItem {
  return {
    id,
    kind: 'episode',
    title: id,
    preview: `preview ${id}`,
    meta: '2026-09-01T00:00:00Z',
    deletable: true,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetBrainListCacheForTests();
  api.counts.mockResolvedValue({});
  api.list.mockResolvedValue([]);
  useAthenaStore.setState({ brainView: { open: true, kind: 'episode', id: null } });
});

describe('BrainViewer ListView paging', () => {
  it('asks for one viewport page, not the full kind dump', async () => {
    api.list.mockResolvedValue(Array.from({ length: 21 }, (_, i) => item(`ep_${i}`)));
    render(<BrainViewer />);
    await waitFor(() => expect(api.list).toHaveBeenCalled());
    expect(api.list).toHaveBeenCalledWith('episode', { limit: 21, offset: 0 });
    await waitFor(() => expect(screen.getByText('ep_0')).toBeInTheDocument());
    expect(screen.getByText('ep_19')).toBeInTheDocument();
    expect(screen.queryByText('ep_20')).not.toBeInTheDocument();
  });

  it('keeps painted rows and appends the next page on load-more', async () => {
    api.list
      .mockResolvedValueOnce(Array.from({ length: 21 }, (_, i) => item(`ep_${i}`)))
      .mockResolvedValueOnce(Array.from({ length: 5 }, (_, i) => item(`ep_${20 + i}`)));
    render(<BrainViewer />);
    await waitFor(() => expect(screen.getByTestId('brain-list-load-more')).toBeInTheDocument());
    expect(screen.getByText('ep_0')).toBeInTheDocument();

    await userEvent.click(screen.getByTestId('brain-list-load-more'));
    await waitFor(() => expect(api.list).toHaveBeenCalledTimes(2));
    expect(api.list).toHaveBeenLastCalledWith('episode', { limit: 21, offset: 20 });
    await waitFor(() => expect(screen.getByText('ep_20')).toBeInTheDocument());
    expect(screen.getByText('ep_0')).toBeInTheDocument();
    expect(screen.queryByTestId('brain-list-load-more')).not.toBeInTheDocument();
  });

  it('does not hide chrome behind a spinner while the first page is in flight', () => {
    api.list.mockReturnValue(new Promise(() => {}));
    render(<BrainViewer />);
    expect(screen.getByText(/Brain/)).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
