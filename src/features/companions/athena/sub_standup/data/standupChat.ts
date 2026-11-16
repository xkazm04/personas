/**
 * "Plan with Athena": the page hands the standup interview to Athena's chat,
 * the in-app mirror of `/athena --standup` (client mode). She walks the open
 * cards in the conversation and writes each decision back with her
 * `standup_decide` op; the go-gate (arm) stays a press on this page.
 *
 * The brief is filed as an app prompt (`source`), never as the operator's
 * words (see `AppPromptRequest`), in a conversation of its own per revision:
 * pressing again reopens that thread instead of starting the interview twice.
 */
import { companionCreateConversation } from '@/api/companion';
import type { Translations } from '@/i18n/useTranslation';
import { silentCatch } from '@/lib/silentCatch';
import { useAthenaStore } from '../../athenaStore';
import { isOpen } from '../model/keymap';
import type { RowView, StandupView } from '../model/types';

/** The provenance label Athena sees: `[Automated request from Standup ...]`. */
export const STANDUP_CHAT_SOURCE = 'Standup';

type Fill = (template: string, vars: Record<string, string | number>) => string;

/** One card as a block Athena can act on: name, ids, state, what moved, the directions on it. */
function cardLines(row: RowView, word: (r: RowView) => string, s: Translations['athena']['standup']['chat']): string[] {
  const head = `- ${row.name} [${s.item} ${row.itemId}] (${word(row)})`;
  const out = [row.evidence ? `${head}: ${row.evidence}` : head];
  if (!isOpen(row) && row.headline) out.push(`  ${s.on_card}: ${row.headline}`);
  for (const p of row.proposals) out.push(`  * ${p.text}${p.recommended ? ` (${s.your_pick})` : ''}${p.rationale ? `: ${p.rationale}` : ''}`);
  return out;
}

/** The whole brief: who asks, what to do, then every card (open first) and what waits on the operator. */
export function standupBrief(view: StandupView, t: Translations, tx: Fill): string {
  const s = t.athena.standup.chat;
  const word = (r: RowView) => t.athena.standup.state[r.state] ?? r.state;
  const cards = view.rows.filter((r) => r.itemId && r.kind !== 'hold');
  const open = cards.filter(isOpen);
  const settled = cards.filter((r) => !isOpen(r));
  const holds = view.rows.filter((r) => r.kind === 'hold');
  const lines = [tx(s.intro, { n: view.revision, id: view.id ?? '' }), '', s.steps];
  if (open.length) lines.push('', tx(s.open_head, { n: open.length }), ...open.flatMap((r) => cardLines(r, word, s)));
  if (settled.length) lines.push('', tx(s.settled_head, { n: settled.length }), ...settled.flatMap((r) => cardLines(r, word, s)));
  if (holds.length) lines.push('', tx(s.waits_head, { n: holds.length }), ...holds.map((r) => `- ${r.name}: ${r.headline}`));
  return lines.join('\n');
}

/** The thread's title: one per standup revision (revisions restart at 1 per standup), so a second press finds it again. */
export function standupChatTitle(view: StandupView, t: Translations, tx: Fill): string {
  const short = (view.id ?? '').replace(/^[a-z]+[_-]/, '').slice(0, 6);
  return tx(t.athena.standup.chat.title, { n: view.revision, id: short });
}

/**
 * Open (or reopen) the revision's planning thread and, when it is new, send the
 * brief into it. Resolves once the thread is focused; a failed create falls back
 * to sending into the current conversation, so the press is never lost.
 */
export async function startStandupChat(view: StandupView, t: Translations, tx: Fill): Promise<void> {
  const store = useAthenaStore.getState();
  const title = standupChatTitle(view, t, tx);
  const existing = store.conversations.find((c) => c.title === title);
  if (existing) {
    store.setActiveConversationId(existing.id);
    store.setState('open');
    return;
  }
  const text = standupBrief(view, t, tx);
  try {
    const row = await companionCreateConversation(title, 'forwarded');
    const s = useAthenaStore.getState();
    s.upsertConversation(row);
    s.setActiveConversationId(row.id);
  } catch (err) {
    silentCatch('StandupPanel.companion_create_conversation')(err);
  }
  useAthenaStore.getState().setPendingChatPrompt({ text, source: STANDUP_CHAT_SOURCE });
}
