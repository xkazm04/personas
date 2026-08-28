import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

import type { PersonaMemory } from '@/lib/bindings/PersonaMemory';
import { useOverviewStore } from '@/stores/overviewStore';
import { __resetResolvedConflicts } from '../../libs/memoryConflicts';
import { MemoryConflictReview } from '../MemoryConflictReview';

/**
 * `detectConflicts` only sees the last fetched page (memorySlice caps at 100
 * rows, 500 while searching), but the banner used to announce its result as a
 * store-wide verdict — so a store past the cap got a clean bill of health for
 * rows nothing had looked at. These pin that the surface now names the window
 * it actually audited, and that it says nothing extra when the window IS the
 * whole store.
 */
let seq = 0;
function memory(over: Partial<PersonaMemory> = {}): PersonaMemory {
  seq += 1;
  return {
    id: `mem-${seq}`,
    persona_id: 'persona-a',
    title: `title ${seq}`,
    content: `content ${seq}`,
    category: 'fact',
    source_execution_id: null,
    importance: 3,
    tags: null,
    tier: 'active',
    access_count: 0,
    last_accessed_at: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    use_case_id: null,
    home_team_id: null,
    derived_from: null,
    open_claim_count: 0,
    ...over,
  };
}

/** A pair `detectConflicts` reports as a duplicate. */
function duplicatePair(): PersonaMemory[] {
  const content = 'deploy the webhook relay on fridays after the smoke suite passes';
  return [memory({ title: 'release rule', content }), memory({ title: 'release rule', content })];
}

function setStore(memories: PersonaMemory[], memoriesTotal: number) {
  useOverviewStore.setState({ memories, memoriesTotal });
}

describe('MemoryConflictReview — audit scope', () => {
  beforeEach(() => {
    __resetResolvedConflicts();
  });

  it('names the audited window when the page is smaller than the store', () => {
    const page = duplicatePair();
    setStore(page, 900);

    render(<MemoryConflictReview />);

    // Assert the BANNER path specifically — the zero-conflict branch carries a
    // "most recent memories" phrase too, so matching that alone would pass even
    // if the fixture stopped producing a conflict.
    expect(screen.getByText(/1 conflict detected/i)).toBeInTheDocument();
    expect(screen.getByText(/in the 2 most recent memories/i)).toBeInTheDocument();
  });

  it('claims nothing extra when the page IS the whole store', () => {
    const page = duplicatePair();
    setStore(page, page.length);

    render(<MemoryConflictReview />);

    expect(screen.getByText(/1 conflict detected/i)).toBeInTheDocument();
    expect(screen.queryByText(/most recent memories/i)).not.toBeInTheDocument();
  });

  it('does not certify the store as clean on a partial audit with no conflicts', () => {
    setStore([memory({ content: 'a wholly unrelated note about kitchen taps' })], 900);

    render(<MemoryConflictReview />);

    expect(screen.getByText(/No conflicts in the 1 most recent memories/i)).toBeInTheDocument();
  });
});
