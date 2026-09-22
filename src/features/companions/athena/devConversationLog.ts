/**
 * devConversationLog — pure serializer behind the dev-only "save
 * conversation log" header button. Renders the active conversation plus
 * the session-scoped side channels (narration/tool trail, TodoWrite
 * plan, turn summaries, recall previews, autonomous-actions ledger)
 * into one markdown document for reflective development.
 *
 * Pure data in → string out: no store imports, no IPC. The button
 * gathers the inputs from `useCompanionStore.getState()` and ships the
 * result to `companion_export_conversation_log` (debug builds only).
 */

import type { CompanionMessage, CompanionRecallPreview } from '@/api/companion';
import type { NarrationEntry, StoredNarration } from './narrationTimeline';
import type { TodoStep } from './operationalSteps';
import type { AthenaAction, StoredTurnSummary } from './companionStore';

export interface ConversationLogInput {
  conversationId: string;
  exportedAt: Date;
  messages: CompanionMessage[];
  narrationByEpisodeId: Record<string, StoredNarration>;
  stepsByEpisodeId: Record<string, TodoStep[]>;
  turnSummaryByEpisodeId: Record<string, StoredTurnSummary>;
  recallByEpisodeId: Record<string, CompanionRecallPreview>;
  athenaActions: AthenaAction[];
}

const pad = (n: number) => String(n).padStart(2, '0');

/** `YYYY-MM-DD_HH-MM-SS-<conversationId>`, local time, filesystem-safe. */
export function buildLogFileStem(conversationId: string, now: Date): string {
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(
    now.getHours(),
  )}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
  const safeId = conversationId.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40) || 'conversation';
  return `${stamp}-${safeId}`;
}

function seconds(fromMs: number, toMs: number): string {
  return `${((toMs - fromMs) / 1000).toFixed(1)}s`;
}

function narrationLine(entry: NarrationEntry): string {
  if (entry.kind === 'tool') {
    const name = entry.toolName ?? 'tool';
    const detail = entry.detail ? ` ${entry.detail}` : '';
    const dur = entry.endedAt != null ? ` (${seconds(entry.at, entry.endedAt)})` : ' (unfinished)';
    return `- [tool] ${name}${detail}${dur}`;
  }
  return `- (beat) ${entry.text ?? ''}`;
}

function recallLines(preview: CompanionRecallPreview): string[] {
  const lines: string[] = [`- episodes consulted: ${preview.episodeCount}`];
  const groups: Array<[string, { title: string }[]]> = [
    ['doctrine', preview.doctrine],
    ['facts', preview.facts],
    ['procedurals', preview.procedurals],
    ['goals', preview.goals],
    ['backlog', preview.backlog],
  ];
  for (const [label, entries] of groups) {
    if (entries.length > 0) {
      lines.push(`- ${label}: ${entries.map((e) => e.title).join('; ')}`);
    }
  }
  if (preview.synthesized) lines.push('- (synthesis briefing replaced raw chunks)');
  return lines;
}

function turnSummaryLine(s: StoredTurnSummary): string {
  const parts = [
    `approvals ${s.approvals}`,
    `navigations ${s.navigations}`,
    `lab opens ${s.labOpens}`,
    `dashboards ${s.dashboards}`,
    `cockpits ${s.cockpits}`,
    `chat cards ${s.chatCards}`,
  ];
  if (s.continuation) parts.push('continuation');
  return parts.join(' · ');
}

export function buildConversationLogMarkdown(input: ConversationLogInput): string {
  const out: string[] = [
    '# Athena conversation log',
    '',
    `- Conversation: \`${input.conversationId}\``,
    `- Exported: ${input.exportedAt.toISOString()}`,
    `- Messages: ${input.messages.length} (full conversation — the export walks keyset pages back to the first turn)`,
    '',
    '---',
  ];

  for (const m of input.messages) {
    out.push('', `## ${m.role} — ${m.createdAt} (\`${m.id}\`)`, '', m.content.trimEnd());

    const narration = input.narrationByEpisodeId[m.id];
    if (narration && narration.entries.length > 0) {
      out.push(
        '',
        `### What I did (${narration.entries.length} entries · ${seconds(narration.startedAt, narration.endedAt)})`,
        ...narration.entries.map(narrationLine),
      );
    }
    const steps = input.stepsByEpisodeId[m.id];
    if (steps && steps.length > 0) {
      out.push(
        '',
        '### Plan (TodoWrite)',
        ...steps.map((s) => `- [${s.status === 'completed' ? 'x' : ' '}] ${s.content} (${s.status})`),
      );
    }
    const summary = input.turnSummaryByEpisodeId[m.id];
    if (summary) {
      out.push('', '### Turn summary', turnSummaryLine(summary));
    }
    const recall = input.recallByEpisodeId[m.id];
    if (recall) {
      out.push('', '### Recall', ...recallLines(recall));
    }
  }

  if (input.athenaActions.length > 0) {
    out.push('', '---', '', '## Autonomous actions (session ledger, newest first)', '');
    for (const a of input.athenaActions) {
      const project = a.projectLabel ? ` · ${a.projectLabel}` : '';
      out.push(`- ${new Date(a.createdAt).toISOString()} [${a.sessionId}${project}] ${a.text}`);
    }
  }

  out.push('');
  return out.join('\n');
}
