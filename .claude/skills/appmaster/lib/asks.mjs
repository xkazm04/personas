// The operator channel and the local ask queue (WP1). Writes only the journal (channel.jsonl,
// asks.jsonl) and the outbox; what the app owns reaches it on replay, never from here.
//
// The two `ask` outbox payloads are told apart by `op`: {op:'raise', ...} (decide, and the WP2
// merge gate, whose payload has no `op` and is read as a raise) and {op:'resolve', ...} (answer).

import fs from 'node:fs';
import { Refusal, nowIso } from './contract.mjs';
import { appendChannel, listSlugs, loadAsks, loadOutbox, openAsks, queueOutbox, updateAsk } from './store.mjs';
import { resolveManaged } from './dbread.mjs';

/** The free-form choice an operator may make instead of one of the master's options. */
export const OTHER_CHOICE = 'Other';

function projectIdFor(slug, askId) {
  for (const e of loadOutbox(slug)) if (e.kind === 'ask' && e.payload?.askId === askId && e.projectId) return e.projectId;
  try { return resolveManaged(slug).project?.id ?? null; } catch { return null; }
}

/** (args) => {id}   // --project p --file msg.md (or --text "...") */
export async function cmdSay({ flags = {} } = {}) {
  const message = flags.file && flags.file !== true ? fs.readFileSync(flags.file, 'utf8') : (flags.text === true ? '' : flags.text);
  if (!message || !String(message).trim()) throw new Error('--file <msg.md> (or --text "<msg>") with a non-empty message is required');
  const { slug, project } = resolveManaged(flags.project);
  if (!project?.id) throw new Error(`no project record for ${slug}: run context first`);
  const row = appendChannel(slug, String(message), 'operator');
  // Operator -> master messages also belong in the master's in-app channel: queued for replay.
  const entry = queueOutbox(slug, project.id, 'say', { message: String(message), from: 'operator', channelId: row.id }, {});
  return { id: row.id, slug, outbox: entry.id };
}

/** (args) => Ask[]   // open asks of one project, or of every managed project */
export async function cmdAsks({ flags = {} } = {}) {
  const slugs = flags.project && flags.project !== true ? [resolveManaged(flags.project).slug] : listSlugs();
  return slugs.flatMap((s) => openAsks(s)).sort((a, b) => String(a.raisedAt).localeCompare(String(b.raisedAt)));
}

/** Find an ask by full id or a unique prefix across every managed project. */
export function findAsk(ref) {
  const hits = [];
  for (const slug of listSlugs()) for (const a of loadAsks(slug)) if (a.askId === ref || String(a.askId).startsWith(ref)) hits.push(a);
  const exact = hits.find((a) => a.askId === ref);
  if (exact) return exact;
  if (hits.length > 1) throw new Error(`ask "${ref}" is ambiguous (${hits.length} matches)`);
  return hits[0] ?? null;
}

/** (args) => Ask   // --ask id --choice label [--notes text]; also queues an outbox ask resolution */
export async function cmdAnswer({ flags = {} } = {}) {
  if (!flags.ask || flags.ask === true) throw new Error('--ask <askId> is required');
  if (!flags.choice || flags.choice === true) throw new Error('--choice <label> is required');
  const notes = flags.notes && flags.notes !== true ? String(flags.notes) : '';
  const ask = findAsk(String(flags.ask));
  if (!ask) throw new Error(`no ask ${flags.ask}`);
  if (ask.state !== 'open') throw new Refusal('ask already answered', { askId: ask.askId, answer: ask.answer ?? null });
  const want = String(flags.choice).trim();
  const option = (ask.options ?? []).find((o) => String(o.label).trim().toLowerCase() === want.toLowerCase());
  let choice;
  if (option) choice = option.label;
  else if (want.toLowerCase() === OTHER_CHOICE.toLowerCase()) {
    if (!notes.trim()) throw new Refusal('choice Other needs --notes', { askId: ask.askId });
    choice = OTHER_CHOICE;
  } else {
    throw new Refusal('choice is not an option', { askId: ask.askId, options: (ask.options ?? []).map((o) => o.label).concat(OTHER_CHOICE) });
  }
  const answer = { choice, notes, at: nowIso() };
  const updated = updateAsk(ask.slug, ask.askId, { state: 'answered', answer });
  const projectId = projectIdFor(ask.slug, ask.askId);
  const entry = projectId
    ? queueOutbox(ask.slug, projectId, 'ask', { op: 'resolve', askId: ask.askId, question: ask.question, choice, notes, action: option?.action ?? null }, { wakeId: ask.wakeId })
    : null;
  // The Ask, plus where its resolution went (null: no project id known, so nothing was queued).
  return { ...updated, outbox: entry?.id ?? null };
}
