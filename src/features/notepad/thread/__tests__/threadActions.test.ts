// The thread verbs' ROUTING — which IPC each review kind reaches, in what
// order, and what the rework loop writes into the next run's brief. The IPC is
// mocked at the wrapper boundary; what is asserted is the sequence.
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { DevNote } from '@/lib/bindings/DevNote';
import type { NoteComment } from '@/lib/bindings/NoteComment';

const api = vi.hoisted(() => ({
  addNoteComment: vi.fn(),
  listNoteComments: vi.fn(),
  resolveNoteSuggestion: vi.fn(),
  setNoteReviewVerdict: vi.fn(),
  markNoteCommentsRead: vi.fn(),
  listNotes: vi.fn(),
  setNoteStatus: vi.fn(),
}));
vi.mock('@/api/notepad', () => ({ ...api, NOTE_CAP: 10 }));

const devTools = vi.hoisted(() => ({
  getProject: vi.fn(),
  installSystemSkill: vi.fn(),
}));
vi.mock('@/api/devTools/devTools', () => devTools);

const fleet = vi.hoisted(() => ({ writeDispatchBrief: vi.fn() }));
vi.mock('@/api/fleet/fleet', () => fleet);

const companionApi = vi.hoisted(() => ({ companionDispatchFleetPlan: vi.fn() }));
vi.mock('@/api/companion', () => companionApi);

const companion = vi.hoisted(() => {
  const state = {
    chatCards: [] as { id?: string; kind: string; config?: Record<string, unknown> }[],
    setPendingChatPrompt: vi.fn(),
    patchChatCardConfig: vi.fn(),
  };
  return { state };
});
vi.mock('@/features/companions/athena/companionStore', () => ({
  useCompanionStore: {
    getState: () => companion.state,
    subscribe: () => () => undefined,
  },
}));

const catches = vi.hoisted(() => ({ toast: vi.fn(), silent: vi.fn() }));
vi.mock('@/lib/silentCatch', () => ({
  toastCatch: (ctx: string) => (e: unknown) => catches.toast(ctx, e),
  silentCatch: (ctx: string) => (e: unknown) => catches.silent(ctx, e),
}));

import { composeNoteBrief, OPERATOR_FEEDBACK_HEADING } from '../../notepadActions';
import { __resetNoteAskStateForTests, noteAskOf } from '../../notepadAskState';
import { __resetNotepadStoreForTests } from '../../notepadStore';
import { __resetNoteThreadStoreForTests } from '../noteThreadStore';
import {
  approveReview,
  commentOnNote,
  feedbackCommentsSince,
  rejectReview,
} from '../threadActions';

const NOTE: DevNote = {
  id: 'n1',
  projectId: 'p1',
  milestoneId: null,
  title: 'Fix the dock',
  bodyMd: 'Make the dock stop jumping.',
  status: 'published',
  orderIndex: 0,
  dispatchTarget: 'fleet',
  dispatchKey: 'note:n1',
  fleetSessionId: null,
  agentId: null,
  resultJson: null,
  publishedAt: null,
  startedAt: null,
  completedAt: null,
  archivedAt: null,
  createdAt: '2026-09-21T09:00:00Z',
  updatedAt: '2026-09-21T09:00:00Z',
};

const PROJECT = { id: 'p1', name: 'personas', root_path: '/repo' };

const review = (over: Partial<NoteComment> = {}): NoteComment => ({
  id: 'rev1',
  noteId: 'n1',
  authorKind: 'agent',
  authorName: null,
  kind: 'review',
  bodyMd: 'Run completed',
  refKind: 'run',
  refId: 'run-1',
  verdict: 'pending',
  createdAt: '2026-09-21T10:00:00Z',
  readAt: null,
  ...over,
});

const operatorComment = (id: string, body: string, createdAt: string): NoteComment => ({
  ...review(),
  id,
  authorKind: 'operator',
  kind: 'comment',
  bodyMd: body,
  refKind: null,
  refId: null,
  verdict: null,
  createdAt,
  readAt: createdAt,
});

beforeEach(() => {
  vi.clearAllMocks();
  __resetNotepadStoreForTests();
  __resetNoteThreadStoreForTests();
  __resetNoteAskStateForTests();
  companion.state.chatCards = [];
  api.setNoteReviewVerdict.mockImplementation(async (id: string, verdict: string) => review({ id, verdict: verdict as NoteComment['verdict'] }));
  api.listNotes.mockResolvedValue([NOTE]);
  api.listNoteComments.mockResolvedValue([]);
  api.markNoteCommentsRead.mockResolvedValue(undefined);
  devTools.getProject.mockResolvedValue(PROJECT);
  devTools.installSystemSkill.mockResolvedValue({ installed: true });
  fleet.writeDispatchBrief.mockResolvedValue(undefined);
  companionApi.companionDispatchFleetPlan.mockResolvedValue('ok');
});

describe('commentOnNote', () => {
  it('stores the comment, THEN points Athena at the thread, and opens the wait', async () => {
    api.addNoteComment.mockResolvedValue(operatorComment('c1', 'why?', '2026-09-21T10:00:00Z'));
    const r = await commentOnNote(NOTE, '  why?  ');
    expect(r).toEqual({ ok: true });
    expect(api.addNoteComment).toHaveBeenCalledWith('n1', 'why?');
    const prompt = companion.state.setPendingChatPrompt.mock.calls[0]?.[0];
    expect(prompt.source).toBe('notepad');
    expect(prompt.text).toContain('comment_on_note');
    expect(prompt.text).not.toContain('why?');
    expect(noteAskOf('n1')).not.toBeNull();
  });

  it('refuses an empty comment without touching the IPC', async () => {
    expect(await commentOnNote(NOTE, '   ')).toEqual({ ok: false, pending: true });
    expect(api.addNoteComment).not.toHaveBeenCalled();
  });

  it('does not tell Athena about a comment that failed to store', async () => {
    api.addNoteComment.mockRejectedValue(new Error('db'));
    expect(await commentOnNote(NOTE, 'x')).toEqual({ ok: false });
    expect(companion.state.setPendingChatPrompt).not.toHaveBeenCalled();
    expect(catches.toast).toHaveBeenCalled();
  });
});

describe('approveReview', () => {
  const card = {
    id: 'card-1',
    kind: 'note_suggestions',
    config: {
      note_id: 'n1',
      rows: [
        { row_id: 'r1', kind: 'section', body_md: 'A', outcome: null },
        { row_id: 'r2', kind: 'edit', body_md: 'B', outcome: 'rejected' },
        { row_id: 'r3', kind: 'section', body_md: 'C', outcome: null },
      ],
    },
  };

  it('suggestion card: accepts every OPEN row, then stamps approved', async () => {
    companion.state.chatCards = [card];
    const order: string[] = [];
    api.resolveNoteSuggestion.mockImplementation(async (_c: string, rowId: string, outcome: string) => {
      order.push(`${rowId}:${outcome}`);
      return NOTE;
    });
    api.setNoteReviewVerdict.mockImplementation(async (id: string, verdict: string) => {
      order.push(`verdict:${verdict}`);
      return review({ id, refKind: 'suggestion_card', verdict: 'approved' });
    });
    const r = await approveReview(review({ refKind: 'suggestion_card', refId: 'card-1', authorKind: 'athena' }));
    expect(r).toEqual({ ok: true });
    expect(order).toEqual(['r1:accepted', 'r3:accepted', 'verdict:approved']);
  });

  it('suggestion card: a failed row stops the verdict — no "approved" over rows that never landed', async () => {
    companion.state.chatCards = [card];
    api.resolveNoteSuggestion.mockRejectedValue(new Error('not editable'));
    const r = await approveReview(review({ refKind: 'suggestion_card', refId: 'card-1' }));
    expect(r).toEqual({ ok: false });
    expect(api.setNoteReviewVerdict).not.toHaveBeenCalled();
  });

  it('run review: stamps approved and nothing else', async () => {
    const r = await approveReview(review());
    expect(r).toEqual({ ok: true });
    expect(api.setNoteReviewVerdict).toHaveBeenCalledWith('rev1', 'approved');
    expect(api.resolveNoteSuggestion).not.toHaveBeenCalled();
    expect(companionApi.companionDispatchFleetPlan).not.toHaveBeenCalled();
  });

  it('refuses a non-review entry', async () => {
    expect(await approveReview(review({ kind: 'comment', verdict: null }))).toEqual({ ok: false, pending: true });
  });
});

describe('rejectReview', () => {
  it('suggestion card: rejects open rows, then stamps rejected (reason optional)', async () => {
    companion.state.chatCards = [
      { id: 'card-1', kind: 'note_suggestions', config: { note_id: 'n1', rows: [{ row_id: 'r1', kind: 'section', body_md: 'A', outcome: null }] } },
    ];
    api.resolveNoteSuggestion.mockResolvedValue(NOTE);
    const r = await rejectReview(review({ refKind: 'suggestion_card', refId: 'card-1' }));
    expect(r).toEqual({ ok: true });
    expect(api.resolveNoteSuggestion).toHaveBeenCalledWith('card-1', 'r1', 'rejected');
    expect(api.setNoteReviewVerdict).toHaveBeenCalledWith('rev1', 'rejected', undefined);
    expect(companionApi.companionDispatchFleetPlan).not.toHaveBeenCalled();
  });

  it('run: refuses without a reason — the rework loop must not ping-pong', async () => {
    expect(await rejectReview(review(), '   ')).toEqual({ ok: false, pending: true });
    expect(api.setNoteReviewVerdict).not.toHaveBeenCalled();
  });

  it('run: stamps rejected, then re-dispatches with the feedback appended — and writes no status', async () => {
    api.listNoteComments.mockResolvedValue([
      operatorComment('before', 'said before the run', '2026-09-21T09:30:00Z'),
      review(),
      operatorComment('after', 'also check the tooltip', '2026-09-21T10:05:00Z'),
      operatorComment('reason', 'It still jumps', '2026-09-21T10:06:00Z'),
    ]);
    const r = await rejectReview(review(), 'It still jumps');
    expect(r).toEqual({ ok: true });
    expect(api.setNoteReviewVerdict).toHaveBeenCalledWith('rev1', 'rejected', 'It still jumps');

    const brief = fleet.writeDispatchBrief.mock.calls[0]?.[2] as string;
    expect(brief).toContain(OPERATOR_FEEDBACK_HEADING);
    expect(brief).toContain('Reason: It still jumps');
    expect(brief).toContain('- also check the tooltip');
    expect(brief).not.toContain('said before the run');
    // The reason is stated once, not echoed again as a comment.
    expect(brief.match(/It still jumps/g)).toHaveLength(1);

    expect(companionApi.companionDispatchFleetPlan).toHaveBeenCalledTimes(1);
    expect(api.setNoteStatus).not.toHaveBeenCalled();
  });

  it('run: does not re-dispatch a note the server did not move back to published', async () => {
    api.listNotes.mockResolvedValue([{ ...NOTE, status: 'completed' }]);
    const r = await rejectReview(review(), 'again');
    expect(r).toEqual({ ok: false });
    expect(companionApi.companionDispatchFleetPlan).not.toHaveBeenCalled();
    expect(catches.toast).toHaveBeenCalledWith('notepad rework dispatch', expect.any(Error));
  });

  it('run: uses the caller’s project instead of fetching it', async () => {
    await rejectReview(review(), 'again', { project: PROJECT as never });
    expect(devTools.getProject).not.toHaveBeenCalled();
    expect(fleet.writeDispatchBrief.mock.calls[0]?.[0]).toBe('/repo');
  });
});

describe('composeNoteBrief / feedbackCommentsSince', () => {
  it('a first dispatch carries no feedback section', () => {
    expect(composeNoteBrief(NOTE, 'p1')).not.toContain(OPERATOR_FEEDBACK_HEADING);
  });

  it('the feedback section comes LAST, after the body', () => {
    const brief = composeNoteBrief(NOTE, 'p1', { reason: 'r', comments: ['multi\nline'] });
    expect(brief.indexOf(OPERATOR_FEEDBACK_HEADING)).toBeGreaterThan(brief.indexOf(NOTE.bodyMd));
    expect(brief).toContain('- multi line');
  });

  it('picks operator comments at or after the review, minus the reason', () => {
    const thread = [
      operatorComment('a', 'old', '2026-09-21T09:00:00Z'),
      { ...operatorComment('b', 'athena said', '2026-09-21T10:01:00Z'), authorKind: 'athena' as const },
      operatorComment('c', 'new', '2026-09-21T10:02:00Z'),
      operatorComment('d', 'the reason', '2026-09-21T10:03:00Z'),
    ];
    expect(feedbackCommentsSince(thread, review(), ' the reason ')).toEqual(['new']);
  });
});
