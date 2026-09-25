/**
 * exchange — fold the raw transcript into TURNS for layer one.
 *
 * In the live brain machine-authored system rows outnumber Athena's replies
 * roughly 2.4 to 1. Layer one is for the conversation, so a turn keeps the
 * words (your ask, her reply, her PROGRESS asides) and reduces every machine
 * row to a classified tick. The rows are not lost: a turn carries them for the
 * nested layer, where there is room to read them.
 */

import type { CompanionMessage } from '@/api/companion';
import { systemMarkerOf } from '../../systemMarkers';

export type MachineKind = 'lookup' | 'fleet' | 'blocked' | 'report' | 'rejected' | 'canvas' | 'note';

export interface MachineRow {
  id: string;
  kind: MachineKind;
  content: string;
}

export type TurnTrigger = 'user' | 'autonomous' | 'proactive' | 'fleet';

export interface Turn {
  id: string;
  trigger: TurnTrigger;
  ask: CompanionMessage | null;
  replies: CompanionMessage[];
  asides: string[];
  machine: MachineRow[];
  createdAt: string;
}

export const MACHINE_TONE: Record<MachineKind, string> = {
  lookup: 'var(--status-info)',
  fleet: 'var(--status-neutral)',
  blocked: 'var(--status-warning)',
  report: 'var(--status-success)',
  rejected: 'var(--status-error)',
  canvas: 'var(--muted-dark)',
  note: 'var(--muted-dark)',
};

export function classifyMachine(content: string): MachineKind {
  const t = content.trimStart();
  if (t.startsWith('[lookup]')) return 'lookup';
  if (t.startsWith('fleet-event') || t.startsWith('fleet-orchestration')) {
    return /state:exited_failed/.test(t) ? 'rejected' : 'fleet';
  }
  if (t.startsWith('[dispatcher]')) return 'blocked';
  if (t.startsWith('[canvas]')) return 'canvas';
  if (/^\[Athena action rejected\]|^\[Athena action approved but failed\]/i.test(t)) return 'rejected';
  if (/^\[Athena action (approved|auto-approved)|^\[Fleet\] \S/i.test(t)) return 'report';
  return 'note';
}

const isAside = (m: CompanionMessage) =>
  m.role === 'assistant' && m.content.trimStart().startsWith('PROGRESS:');

export function buildTurns(messages: CompanionMessage[]): Turn[] {
  const turns: Turn[] = [];
  let cur: Turn | null = null;
  const open = (trigger: TurnTrigger, m: CompanionMessage, ask: CompanionMessage | null) => {
    cur = { id: m.id, trigger, ask, replies: [], asides: [], machine: [], createdAt: m.createdAt };
    turns.push(cur);
    return cur;
  };
  for (const m of messages) {
    if (m.role === 'user') {
      open('user', m, m);
      continue;
    }
    if (m.role === 'system') {
      const marker = systemMarkerOf(m.content);
      if (marker) {
        open(marker, m, null);
        continue;
      }
      (cur ?? open('autonomous', m, null)).machine.push({ id: m.id, kind: classifyMachine(m.content), content: m.content });
      continue;
    }
    const turn: Turn = cur ?? open('autonomous', m, null);
    if (isAside(m)) turn.asides.push(m.content.trimStart().replace(/^PROGRESS:\s*/, ''));
    else turn.replies.push(m);
  }
  return turns;
}
