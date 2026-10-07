import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * The "respond with feedback" background chat after it moved onto the one
 * Rust chat turn (`start_chat_turn` -> `chat_turn::start`): it makes ONE call,
 * names the session after the report (the `title` the turn takes for that),
 * and writes nothing itself - the user row, the session context and the
 * assistant row are the Rust turn's. What stays here is the display: the
 * slot's status, the reply preview, the activity row and the notifications.
 */
vi.mock('@/api/agents/chat', () => ({
  startChatTurn: vi.fn(),
  createChatMessage: vi.fn(),
  saveChatSessionContext: vi.fn(),
}));

vi.mock('@/api/agents/executions', () => ({
  executePersona: vi.fn(),
  getExecution: vi.fn(),
}));

vi.mock('@/api/system/system', () => ({
  sendAppNotification: vi.fn(async () => undefined),
}));

const addProcessNotification = vi.fn();
vi.mock('@/stores/notificationCenterStore', () => ({
  useNotificationCenterStore: { getState: () => ({ addProcessNotification }) },
}));

const processStarted = vi.fn();
const processEnded = vi.fn();
vi.mock('@/stores/overviewStore', () => ({
  useOverviewStore: { getState: () => ({ processStarted, processEnded }) },
}));

type Handler = (event: { payload: Record<string, string> }) => unknown;
const handlers = new Map<string, Handler>();
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (name: string, cb: Handler) => {
    handlers.set(name, cb);
    return () => handlers.delete(name);
  }),
}));

vi.mock('@sentry/react', () => ({
  addBreadcrumb: vi.fn(),
  captureException: vi.fn(),
  withScope: (fn: (scope: unknown) => void) => fn({ setTag: vi.fn(), setExtra: vi.fn() }),
}));

import * as chatApi from '@/api/agents/chat';
import * as execApi from '@/api/agents/executions';
import { createBackgroundChatSlice, type BackgroundChatSlice } from '../backgroundChatSlice';

const startChatTurn = vi.mocked(chatApi.startChatTurn);
const createChatMessage = vi.mocked(chatApi.createChatMessage);
const saveChatSessionContext = vi.mocked(chatApi.saveChatSessionContext);
const executePersona = vi.mocked(execApi.executePersona);
const getExecution = vi.mocked(execApi.getExecution);

const INSTRUCTION = '[feedback on "Weekly digest"]\n\n## User feedback\nToo long.';
const TITLE = 'Feedback — Weekly digest';

function harness() {
  let state = {} as BackgroundChatSlice & Record<string, unknown>;
  const set = (partial: unknown) => {
    const patch = typeof partial === 'function'
      ? (partial as (s: typeof state) => object)(state)
      : partial;
    state = { ...state, ...(patch as object) };
  };
  const get = () => state as never;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  state = { ...(createBackgroundChatSlice as any)(set, get, {}) };
  return { get: () => state };
}

function started(sessionId: string) {
  return {
    sessionId,
    userMessage: {
      id: 'm1',
      personaId: 'p1',
      sessionId,
      role: 'user' as const,
      content: INSTRUCTION,
      executionId: null,
      metadata: null,
      createdAt: '2026-10-07T10:00:00Z',
    },
    executionId: 'exec-1',
  };
}

async function listenersReady() {
  await vi.waitFor(() => {
    expect(handlers.has('execution-output')).toBe(true);
    expect(handlers.has('execution-status')).toBe(true);
  });
}

function emit(name: string, payload: Record<string, string>) {
  return handlers.get(name)?.({ payload });
}

function expectNoDirectWrites() {
  expect(createChatMessage).not.toHaveBeenCalled();
  expect(saveChatSessionContext).not.toHaveBeenCalled();
  expect(executePersona).not.toHaveBeenCalled();
  expect(getExecution).not.toHaveBeenCalled();
}

describe('background feedback chat on the one Rust turn', () => {
  afterEach(async () => {
    await vi.dynamicImportSettled();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    handlers.clear();
    startChatTurn.mockImplementation(async (input) => started(input.sessionId));
  });

  it('starts the turn with one call: advisory, named after the report', async () => {
    const h = harness();
    const id = await h.get().startFeedbackChat({
      personaId: 'p1',
      personaName: 'Digest',
      sourceMessageId: 'r1',
      instruction: INSTRUCTION,
      title: TITLE,
    });

    expect(startChatTurn).toHaveBeenCalledTimes(1);
    const call = startChatTurn.mock.calls[0][0];
    expect(call).toMatchObject({
      personaId: 'p1',
      message: INSTRUCTION,
      chatMode: 'advisory',
      title: TITLE,
    });
    expect(call.sessionId).toMatch(/^bgchat-\d+-[0-9a-f]{8}$/);
    expectNoDirectWrites();

    const slot = h.get().backgroundChats[id];
    expect(slot.status).toBe('running');
    expect(slot.executionId).toBe('exec-1');
    expect(slot.sessionId).toBe(call.sessionId);
  });

  it('a completed run shows the reply preview and notifies, writing nothing', async () => {
    const h = harness();
    const id = await h.get().startFeedbackChat({
      personaId: 'p1',
      personaName: 'Digest',
      sourceMessageId: 'r1',
      instruction: INSTRUCTION,
      title: TITLE,
    });
    await listenersReady();
    await emit('execution-output', { execution_id: 'exec-1', line: 'You are right, it ran long.' });
    await emit('execution-output', { execution_id: 'exec-1', line: '> Using tool: Read' });
    await emit('execution-output', { execution_id: 'exec-other', line: 'not mine' });
    await emit('execution-status', { execution_id: 'exec-1', status: 'completed' });

    await vi.waitFor(() => expect(h.get().backgroundChats[id].status).toBe('completed'));
    expect(h.get().backgroundChats[id].assistantReplyPreview).toBe('You are right, it ran long.');
    expect(addProcessNotification).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'success', title: 'Digest replied to your feedback' }),
    );
    expect(processEnded).toHaveBeenCalledWith('feedback-chat', 'completed', id);
    expectNoDirectWrites();
  });

  it('a run that did not complete marks the slot failed, writing nothing', async () => {
    const h = harness();
    const id = await h.get().startFeedbackChat({
      personaId: 'p1',
      sourceMessageId: 'r1',
      instruction: INSTRUCTION,
      title: TITLE,
    });
    await listenersReady();
    await emit('execution-output', { execution_id: 'exec-1', line: 'partial' });
    await emit('execution-status', { execution_id: 'exec-1', status: 'failed' });

    await vi.waitFor(() => expect(h.get().backgroundChats[id].status).toBe('failed'));
    expect(h.get().backgroundChats[id].errorMessage).toBe('Execution ended: failed');
    expect(processEnded).toHaveBeenCalledWith('feedback-chat', 'failed', id);
    expectNoDirectWrites();
  });

  it('a refused turn marks the slot failed', async () => {
    startChatTurn.mockRejectedValue(new Error("Project 'X' is turned off"));
    const h = harness();
    const id = await h.get().startFeedbackChat({
      personaId: 'p1',
      sourceMessageId: 'r1',
      instruction: INSTRUCTION,
      title: TITLE,
    });

    const slot = h.get().backgroundChats[id];
    expect(slot.status).toBe('failed');
    expect(slot.errorMessage).toBe("Project 'X' is turned off");
    expectNoDirectWrites();
  });
});
