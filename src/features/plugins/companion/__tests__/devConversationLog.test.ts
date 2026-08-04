import { describe, expect, it } from 'vitest';
import {
  buildConversationLogMarkdown,
  buildLogFileStem,
  type ConversationLogInput,
} from '../devConversationLog';

function baseInput(over: Partial<ConversationLogInput> = {}): ConversationLogInput {
  return {
    conversationId: 'default',
    exportedAt: new Date('2026-08-05T10:00:00Z'),
    messages: [],
    narrationByEpisodeId: {},
    stepsByEpisodeId: {},
    turnSummaryByEpisodeId: {},
    recallByEpisodeId: {},
    athenaActions: [],
    ...over,
  };
}

describe('buildLogFileStem', () => {
  it('stamps local time and sanitizes the conversation id', () => {
    const stem = buildLogFileStem('default', new Date(2026, 7, 5, 9, 8, 7));
    expect(stem).toBe('2026-08-05_09-08-07-default');
  });

  it('strips unsafe characters and never returns an empty id part', () => {
    const stem = buildLogFileStem('../..\\evil id!', new Date(2026, 0, 1, 0, 0, 0));
    expect(stem).toBe('2026-01-01_00-00-00-evilid');
    expect(buildLogFileStem('///', new Date(2026, 0, 1))).toContain('-conversation');
  });
});

describe('buildConversationLogMarkdown', () => {
  it('renders an empty conversation with header only', () => {
    const md = buildConversationLogMarkdown(baseInput());
    expect(md).toContain('# Athena conversation log');
    expect(md).toContain('- Conversation: `default`');
    expect(md).toContain('- Messages: 0');
    expect(md).not.toContain('## Autonomous actions');
  });

  it('joins side-channel sections to the owning assistant message', () => {
    const md = buildConversationLogMarkdown(
      baseInput({
        messages: [
          { id: 'u1', role: 'user', content: 'Fix the orb', createdAt: '2026-08-05T09:00:00Z' },
          { id: 'ep_abc', role: 'assistant', content: 'Done.', createdAt: '2026-08-05T09:01:00Z' },
        ],
        narrationByEpisodeId: {
          ep_abc: {
            startedAt: 1000,
            endedAt: 49_000,
            entries: [
              { id: 'b1', kind: 'beat', text: 'Reading the logs', at: 1000 },
              { id: 't1', kind: 'tool', toolName: 'Read', detail: 'src/App.tsx', at: 2000, endedAt: 4100 },
              { id: 't2', kind: 'tool', toolName: 'Bash', at: 5000 },
            ],
          },
        },
        stepsByEpisodeId: {
          ep_abc: [
            { content: 'Scan the code', status: 'completed' },
            { content: 'Apply the fix', status: 'in_progress' },
          ],
        },
        turnSummaryByEpisodeId: {
          ep_abc: {
            approvals: 1,
            navigations: 0,
            labOpens: 0,
            dashboards: 0,
            cockpits: 0,
            chatCards: 2,
            continuation: true,
          },
        },
        recallByEpisodeId: {
          ep_abc: {
            episodeCount: 4,
            doctrine: [{ id: 'd1', title: 'Orb doctrine' }],
            facts: [],
            procedurals: [],
            goals: [],
            backlog: [],
            synthesized: true,
          },
        },
      }),
    );
    expect(md).toContain('## user — 2026-08-05T09:00:00Z (`u1`)');
    expect(md).toContain('## assistant — 2026-08-05T09:01:00Z (`ep_abc`)');
    expect(md).toContain('### What I did (3 entries · 48.0s)');
    expect(md).toContain('- (beat) Reading the logs');
    expect(md).toContain('- [tool] Read src/App.tsx (2.1s)');
    expect(md).toContain('- [tool] Bash (unfinished)');
    expect(md).toContain('- [x] Scan the code (completed)');
    expect(md).toContain('- [ ] Apply the fix (in_progress)');
    expect(md).toContain('approvals 1 · navigations 0');
    expect(md).toContain('continuation');
    expect(md).toContain('- episodes consulted: 4');
    expect(md).toContain('- doctrine: Orb doctrine');
    expect(md).toContain('synthesis briefing');
  });

  it('ignores side-channel entries whose episode id has no message', () => {
    const md = buildConversationLogMarkdown(
      baseInput({
        messages: [
          { id: 'u1', role: 'user', content: 'hello', createdAt: '2026-08-05T09:00:00Z' },
        ],
        stepsByEpisodeId: { ep_gone: [{ content: 'orphan', status: 'pending' }] },
      }),
    );
    expect(md).not.toContain('orphan');
    expect(md).not.toContain('### Plan');
  });

  it('renders the autonomous-actions footer when present', () => {
    const md = buildConversationLogMarkdown(
      baseInput({
        athenaActions: [
          {
            id: 'a1',
            sessionId: 'sess-1',
            projectLabel: 'Personas',
            text: 'Nudged the stalled session',
            createdAt: Date.UTC(2026, 7, 5, 8, 30, 0),
          },
        ],
      }),
    );
    expect(md).toContain('## Autonomous actions (session ledger, newest first)');
    expect(md).toContain('[sess-1 · Personas] Nudged the stalled session');
  });
});
