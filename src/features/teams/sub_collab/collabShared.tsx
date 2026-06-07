import type { ReactNode } from 'react';
import { memberById, MOCK_USER, type MockBeat } from './mockData';

/* Shared visual primitives for the Collab mock variants. */

export function MockAvatar({ memberId, size = 'w-7 h-7' }: { memberId: string; size?: string }) {
  const m = memberId === 'user' ? { name: MOCK_USER.name, color: MOCK_USER.color } : memberById(memberId);
  const initials = (m?.name ?? '?')
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  return (
    <span
      className={`flex items-center justify-center ${size} rounded-full bg-secondary/70 border flex-shrink-0 typo-caption font-semibold`}
      style={{ borderColor: m?.color ?? '#9ca3af', color: m?.color ?? '#9ca3af' }}
    >
      {initials}
    </span>
  );
}

export function speakerName(memberId: string): string {
  if (memberId === 'user') return MOCK_USER.name;
  return memberById(memberId)?.name ?? memberId;
}

export function speakerColor(memberId: string): string {
  if (memberId === 'user') return MOCK_USER.color;
  return memberById(memberId)?.color ?? '#9ca3af';
}

export function agoLabel(minutesAgo: number): string {
  if (minutesAgo <= 0) return 'now';
  if (minutesAgo < 60) return `${minutesAgo}m ago`;
  return `${Math.floor(minutesAgo / 60)}h ${minutesAgo % 60}m ago`;
}

/** Kind → accent for markers/rails across the variants. */
export const BEAT_TONE: Record<MockBeat['kind'], string> = {
  note: 'text-fuchsia-300',
  handoff: 'text-violet-300',
  message: 'text-foreground/70',
  artifact: 'text-blue-300',
  bounce: 'text-amber-300',
  question: 'text-red-300',
  memory: 'text-amber-200',
  directive: 'text-emerald-300',
  reply: 'text-foreground/80',
};

export const BEAT_BADGE: Record<MockBeat['kind'], string> = {
  note: 'triage',
  handoff: 'handoff',
  message: 'status',
  artifact: 'artifact',
  bounce: 'changes requested',
  question: 'needs you',
  memory: 'memory',
  directive: 'directive',
  reply: 'reply',
};

export function MockBanner({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-card border border-dashed border-primary/20 bg-secondary/15 typo-caption text-foreground/55 flex-shrink-0">
      {children}
    </div>
  );
}
