import type { ReactNode } from 'react';
import { CONTENT_TONES, type ContentTone } from './contentTones';

/**
 * @catalog ContentPill — the execution-detail severity/state pill (uppercase, semibold, tone fill + tone border). Use for a one-word state on a card header; for a status chip in a list prefer `display/StatusBadge`.
 */
export function ContentPill({ tone = 'amber', children }: { tone?: ContentTone; children: ReactNode }) {
  return (
    <span className={`typo-heading px-1.5 py-0.5 rounded-full uppercase ${CONTENT_TONES[tone].pill}`}>
      {children}
    </span>
  );
}

/**
 * @catalog ContentEyebrow — the execution-detail sub-heading ("SUGGESTED ACTIONS", "BLOCKERS"): uppercase, tracked, semibold. Names a group of items inside a card.
 */
export function ContentEyebrow({ children }: { children: ReactNode }) {
  return (
    <span className="typo-heading text-foreground uppercase tracking-wider">{children}</span>
  );
}

/**
 * @catalog ContentWell — the execution-detail inset well for machine text (context data, event payloads): a darker recessed mono block. Not for prose.
 */
export function ContentWell({ children, pre = false }: { children: ReactNode; pre?: boolean }) {
  return (
    <div
      // `text-sm`, not `typo-code`: this is an extraction, and the source well
      // is 0.875rem. `typo-code` is 0.75rem and would visibly shrink every
      // context block on the execution detail the moment it adopted this.
      className={`px-3 py-2 rounded-lg bg-black/10 font-mono text-sm text-foreground ${
        pre ? 'whitespace-pre-wrap' : ''
      }`}
    >
      {children}
    </div>
  );
}

/**
 * @catalog ContentBullets — the execution-detail bullet list (primary-tinted dot, body text). For short lists of actions or blockers inside a card.
 */
export function ContentBullets({ items, tone }: { items: readonly ReactNode[]; tone?: ContentTone }) {
  const dot = tone ? CONTENT_TONES[tone].ink : 'text-primary/40';
  return (
    <div className="space-y-1">
      {items.map((item, i) => (
        <div key={i} className="flex items-start gap-2 typo-body text-foreground">
          <span className={`${dot} mt-0.5`}>&#8226;</span>
          <span>{item}</span>
        </div>
      ))}
    </div>
  );
}
