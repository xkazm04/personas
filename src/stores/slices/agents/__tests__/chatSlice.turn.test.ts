import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * The desktop chat flow after the persona chat turn moved into Rust
 * (PHASE2-SPEC 5.3): `sendChatMessage` makes ONE call (`start_chat_turn`) and
 * drives only the display; the reply is written by the Rust completion hook,
 * so a completed finalize re-reads the session instead of inserting a row.
 */
vi.mock('@/api/agents/chat', () => ({
  listChatSessions: vi.fn(),
  getChatMessages: vi.fn(),
  deleteChatSession: vi.fn(),
  saveChatSessionContext: vi.fn(),
  getChatSessionContext: vi.fn(),
  startChatTurn: vi.fn(),
  createChatMessage: vi.fn(),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async () => () => {}),
}));

vi.mock('@sentry/react', () => ({
  addBreadcrumb: vi.fn(),
  captureException: vi.fn(),
  withScope: (fn: (scope: unknown) => void) => fn({ setTag: vi.fn(), setExtra: vi.fn() }),
}));

import * as chatApi from '@/api/agents/chat';
import { createChatSlice, type ChatSlice } from '../chatSlice';

const startChatTurn = vi.mocked(chatApi.startChatTurn);
const getChatMessages = vi.mocked(chatApi.getChatMessages);
const getChatSessionContext = vi.mocked(chatApi.getChatSessionContext);
const createChatMessage = vi.mocked(chatApi.createChatMessage);

function message(id: string, role: 'user' | 'assistant', content: string, executionId: string | null = null) {
  return {
    id,
    personaId: 'p1',
    sessionId: 's1',
    role,
    content,
    executionId,
    metadata: null,
    createdAt: '2026-10-06T10:00:00Z',
  };
}

const context = {
  sessionId: 's1',
  personaId: 'p1',
  title: 'Hello',
  summary: null,
  systemPromptHash: null,
  workingMemory: null,
  chatMode: 'advisory',
  claudeSessionId: null,
  updatedAt: '2026-10-06T10:00:00Z',
  createdAt: '2026-10-06T10:00:00Z',
};

function harness() {
  let state = {} as ChatSlice & Record<string, unknown>;
  const set = (partial: unknown) => {
    const patch = typeof partial === 'function'
      ? (partial as (s: typeof state) => object)(state)
      : partial;
    state = { ...state, ...(patch as object) };
  };
  const get = () => state as never;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  state = { ...(createChatSlice as any)(set, get, {}), appendExecutionOutput: vi.fn() };
  return { get: () => state, set };
}

describe('chatSlice persona chat turn', () => {
  // The output listeners attach through dynamic imports; let them settle
  // inside the test environment.
  afterEach(async () => {
    await vi.dynamicImportSettled();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    getChatSessionContext.mockResolvedValue(context);
  });

  it('sends through the one Rust turn and shows the stored user message', async () => {
    startChatTurn.mockResolvedValue({
      sessionId: 's1',
      userMessage: message('m1', 'user', 'Hello'),
      executionId: 'exec-1',
    });
    const h = harness();
    await h.get().startNewChatSession();
    const sid = h.get().activeChatSessionId as string;
    await h.get().sendChatMessage('p1', sid, 'Hello');

    expect(startChatTurn).toHaveBeenCalledTimes(1);
    expect(startChatTurn.mock.calls[0][0]).toMatchObject({
      personaId: 'p1',
      sessionId: sid,
      message: 'Hello',
      chatMode: 'advisory',
    });
    expect(createChatMessage).not.toHaveBeenCalled();
    expect(h.get().chatMessages.map((m) => m.id)).toEqual(['m1']);
    expect(h.get().activeExecutionId).toBe('exec-1');
    expect(h.get().chatStreaming).toBe(true);
    expect(h.get().streamingChatSessionId).toBe(sid);
  });

  it('a completed finalize re-reads the session instead of writing the reply', async () => {
    startChatTurn.mockResolvedValue({
      sessionId: 's1',
      userMessage: message('m1', 'user', 'Hello'),
      executionId: 'exec-1',
    });
    getChatMessages.mockResolvedValue([
      message('m1', 'user', 'Hello'),
      message('m2', 'assistant', 'Hi!', 'exec-1'),
    ]);
    const h = harness();
    h.set({ activeChatSessionId: 's1' });
    await h.get().sendChatMessage('p1', 's1', 'Hello');
    await h.get().finishChatStream('Hi!', 'p1', 's1', 'exec-1', 'completed');

    expect(createChatMessage).not.toHaveBeenCalled();
    expect(getChatMessages).toHaveBeenCalledWith('p1', 's1');
    expect(h.get().chatMessages.map((m) => m.id)).toEqual(['m1', 'm2']);
    expect(h.get().chatStreaming).toBe(false);
  });

  it('a failed run surfaces an error and writes nothing', async () => {
    startChatTurn.mockResolvedValue({
      sessionId: 's1',
      userMessage: message('m1', 'user', 'Hello'),
      executionId: 'exec-1',
    });
    const h = harness();
    await h.get().sendChatMessage('p1', 's1', 'Hello');
    getChatMessages.mockClear();
    await h.get().finishChatStream('partial', 'p1', 's1', 'exec-1', 'failed');

    expect(createChatMessage).not.toHaveBeenCalled();
    expect(getChatMessages).not.toHaveBeenCalled();
    expect(h.get().chatStreaming).toBe(false);
    expect(h.get().error).toBeTruthy();
  });

  it('a refused run resets the composer and shows the message that was stored', async () => {
    startChatTurn.mockRejectedValue(new Error("Project 'X' is turned off"));
    getChatMessages.mockResolvedValue([message('m1', 'user', 'Hello')]);
    const h = harness();
    await h.get().startNewChatSession();
    const sid = h.get().activeChatSessionId as string;
    await h.get().sendChatMessage('p1', sid, 'Hello');
    await vi.waitFor(() => expect(getChatMessages).toHaveBeenCalledWith('p1', sid));

    expect(h.get().chatStreaming).toBe(false);
    expect(h.get().isExecuting).toBe(false);
    expect(h.get().streamingChatSessionId).toBeNull();
  });
});
