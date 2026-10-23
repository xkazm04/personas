/**
 * WP12 variants: what all three share. The tab's own frame (the `ae-root`
 * panel with its command row, as ConversationBriefing draws it today), the
 * thread rendered from the fixture, and `MountOver`, which puts a variant in
 * place of today's tab INSIDE the real Monitor (its header, tabs, fleet strip
 * and dispatch dock stay the app's own).
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { MessagesSquare } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import '@/features/fleet/monitor/grid/prototype/entry-e/entryE.css';
import { DayRule, DelibBand, ProposalBand, RunBand, TalkLine } from './conversationVariantsBands';
import { THREAD, type ThreadRow } from './conversationVariantsData';

export function Frame({ children, title }: { children: ReactNode; title?: ReactNode }) {
  const { t } = useTranslation();
  return (
    <div className="ae-root flex h-full min-h-0 flex-col overflow-hidden rounded-card border border-border" data-testid="cv-frame">
      <div className="flex min-h-[52px] flex-shrink-0 items-center gap-3 border-b border-border px-3 py-2">
        <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full border border-primary/40 bg-primary/10" aria-hidden>
          <MessagesSquare className="h-4 w-4 text-primary" />
        </span>
        <span className="typo-heading text-foreground">{t.monitor.conv_title}</span>
        {title}
      </div>
      <div className="flex min-h-0 flex-1 gap-2 p-2.5">{children}</div>
    </div>
  );
}

/** One thread row; `slot` lets a variant hang something under a row (an inline decision). */
export function ThreadRows({ rows = THREAD, open = [], slot, skip }: {
  rows?: ThreadRow[];
  open?: string[];
  slot?: (row: ThreadRow) => ReactNode;
  skip?: (row: ThreadRow) => boolean;
}) {
  return (
    <>
      {rows.map((row, i) => {
        if (skip?.(row)) return null;
        const key = 'id' in row ? row.id : `day-${i}`;
        const extra = slot?.(row);
        switch (row.kind) {
          case 'day': return <DayRule key={key} label={row.label} />;
          case 'run': return <RunBand key={key} run={row} open={open.includes(row.id)}>{extra}</RunBand>;
          case 'delib': return <div key={key}><DelibBand d={row} open={open.includes(row.id)} />{extra}</div>;
          case 'talk': return <div key={key}><TalkLine row={row} />{extra}</div>;
          case 'proposal': return <ProposalBand key={key} row={row} />;
        }
      })}
    </>
  );
}

/** The thread's scroller, pinned to the newest line on mount (as VirtualConversation pins it), or to `anchor`. */
export function ThreadScroll({ children, className = '', anchor }: { children: ReactNode; className?: string; anchor?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const pin = () => {
      const box = ref.current;
      if (!box) return;
      const el = anchor ? box.querySelector<HTMLElement>(anchor) : null;
      if (el) box.scrollTop += el.getBoundingClientRect().bottom - box.getBoundingClientRect().bottom + 16;
      else box.scrollTop = box.scrollHeight;
    };
    pin();
    const id = window.setTimeout(pin, 400);
    return () => window.clearTimeout(id);
  }, [anchor]);
  return <div ref={ref} className={`relative min-h-0 flex-1 overflow-y-auto ${className}`}>{children}</div>;
}

/**
 * Hides today's Conversations tab and renders `children` in its place, in the
 * same box. Harness-only: it waits for the tab's own sidebar splitter to know
 * the tab is up, then hangs a sibling host beside the tab's root.
 */
export function MountOver({ children }: { children: ReactNode }) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => {
    let live = true;
    let made: HTMLElement | null = null;
    const find = () => {
      if (!live) return;
      const root = document.querySelector('[data-testid="conversation-sidebar-resize"]')?.closest('.ae-root');
      if (!(root instanceof HTMLElement) || !root.parentElement) { window.setTimeout(find, 100); return; }
      root.style.display = 'none';
      made = document.createElement('div');
      made.className = 'h-full';
      root.parentElement.appendChild(made);
      setHost(made);
    };
    find();
    return () => { live = false; made?.remove(); };
  }, []);
  return host ? createPortal(children, host) : null;
}
