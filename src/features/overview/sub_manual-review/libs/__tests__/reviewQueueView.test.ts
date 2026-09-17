import { describe, expect, it } from 'vitest';
import { resolveReviewQueueView } from '../reviewHelpers';

// A failed `useLayeredList` fetch used to fall through to the
// `filteredReviews.length === 0` branch and paint the "all caught up"
// approval hero with a Create Persona CTA. Operators celebrated a queue that
// had not loaded. These cases pin the four bodies apart.
describe('resolveReviewQueueView', () => {
  it('renders the error body when the fetch failed and no rows are showing', () => {
    expect(resolveReviewQueueView({ loading: false, error: 'IPC timed out', visibleCount: 0 })).toBe('error');
  });

  it('keeps `empty` for a successful fetch that returned nothing', () => {
    expect(resolveReviewQueueView({ loading: false, error: null, visibleCount: 0 })).toBe('empty');
  });

  it('shows the ghost while a first load is in flight, not the error or the hero', () => {
    expect(resolveReviewQueueView({ loading: true, error: null, visibleCount: 0 })).toBe('ghost');
    // A retry after a failure is still a load, and the ghost wins over the
    // stale error so the surface does not flicker between the two.
    expect(resolveReviewQueueView({ loading: true, error: 'boom', visibleCount: 0 })).toBe('ghost');
  });

  it('never hides rendered rows for a refetch or a failed refetch', () => {
    expect(resolveReviewQueueView({ loading: true, error: null, visibleCount: 3 })).toBe('list');
    expect(resolveReviewQueueView({ loading: false, error: 'boom', visibleCount: 3 })).toBe('list');
  });
});
