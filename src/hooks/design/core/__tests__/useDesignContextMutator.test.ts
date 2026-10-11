import { describe, it, expect, vi } from 'vitest';

const persona = { id: 'persona-1', design_context: 'start' };
const state = {
  personas: [persona],
  selectedPersona: persona as typeof persona | null,
  applyPersonaOp: vi.fn(async (_id: string, op: { design_context: string }) => {
    state.personas[0] = { ...state.personas[0], design_context: op.design_context };
  }),
};
vi.mock('@/stores/agentStore', () => ({
  useAgentStore: Object.assign(vi.fn(), { getState: () => state }),
}));
vi.mock('@/features/agents/sub_lab/use-cases/UseCasesList', () => ({
  parseDesignContext: vi.fn(), serializeDesignContext: vi.fn(), mergeCredentialLink: vi.fn(),
}));

import { applyDesignContextMutation } from '../useDesignContextMutator';

describe('applyDesignContextMutation', () => {
  it('reads the latest persona row after selection changes while writes are queued', async () => {
    const first = applyDesignContextMutation('persona-1', (ctx) => `${ctx}:A`);
    const second = applyDesignContextMutation('persona-1', (ctx) => `${ctx}:B`);
    state.selectedPersona = null;

    expect(await first).toEqual({ applied: true });
    expect(await second).toEqual({ applied: true });
    expect(state.personas[0].design_context).toBe('start:A:B');
  });
});
