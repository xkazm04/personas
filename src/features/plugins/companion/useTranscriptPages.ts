/**
 * Transcript pagination — scroll-to-top loads the next older page.
 *
 * The transcript read used to hard-cap at the newest 500 episodes with no
 * way to reach past them, so a heavy day silently lost its morning from
 * both the scrollback and the dev conversation-log export. The backend
 * now serves keyset pages (`companion_list_messages_before`); this hook
 * is the panel's driver for them.
 *
 * The cursor is DERIVED from the oldest loaded message rather than kept
 * as its own monotonic state. That's what keeps paging correct across the
 * transcript refetches the panel already does (a finished turn replaces
 * the list with the newest 50): the anchor simply moves back to that
 * page's oldest row and scrolling up pages again from there.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  companionListMessagesBefore,
  type CompanionMessage,
  type CompanionMessagePage,
} from '@/api/companion';
import { silentCatch } from '@/lib/silentCatch';
import { useCompanionStore } from './companionStore';

/** Page size for "load earlier" — matches the initial transcript load. */
export const TRANSCRIPT_PAGE_SIZE = 50;

/** How close to the top of the scroll container triggers the next page. */
const LOAD_TRIGGER_PX = 120;

/**
 * A page whose rows were ALL filtered out (fleet-event system rows)
 * yields nothing visible. Keep walking within the same call so the user
 * doesn't have to scroll again — bounded so a long run of system rows
 * can't spin.
 */
const MAX_PAGES_PER_LOAD = 5;

export interface TranscriptCursor {
  beforeCreatedAt: string;
  beforeId: string;
}

/** The cursor implied by a transcript: its oldest message. */
export function cursorFromMessages(messages: CompanionMessage[]): TranscriptCursor | null {
  const oldest = messages[0];
  if (!oldest?.id || !oldest.createdAt) return null;
  return { beforeCreatedAt: oldest.createdAt, beforeId: oldest.id };
}

/** Advance a cursor from a served page. Null when the page had no rows. */
export function cursorFromPage(page: CompanionMessagePage): TranscriptCursor | null {
  if (!page.nextBeforeCreatedAt || !page.nextBeforeId) return null;
  return { beforeCreatedAt: page.nextBeforeCreatedAt, beforeId: page.nextBeforeId };
}

/**
 * Walk every older page from `cursor` and return the messages
 * oldest-first. Used by the conversation-log export to dump the FULL
 * conversation instead of the newest window.
 *
 * `maxPages` is a safety rail, not a product limit — at 50 rows a page
 * the default reaches 10k messages.
 */
export async function fetchAllOlderMessages(
  conversationId: string,
  cursor: TranscriptCursor,
  maxPages = 200,
): Promise<CompanionMessage[]> {
  const collected: CompanionMessage[][] = [];
  let next: TranscriptCursor | null = cursor;
  for (let i = 0; i < maxPages && next; i++) {
    const page: CompanionMessagePage = await companionListMessagesBefore({
      ...next,
      limit: TRANSCRIPT_PAGE_SIZE,
      conversationId,
    });
    if (page.messages.length > 0) collected.unshift(page.messages);
    if (page.exhausted) break;
    next = cursorFromPage(page);
  }
  return collected.flat();
}

export interface UseTranscriptPagesResult {
  /** A page is in flight. */
  loadingOlder: boolean;
  /** No older page exists behind the currently oldest message. */
  exhausted: boolean;
  /** Manual trigger (the scroll listener calls the same thing). */
  loadOlder: () => void;
}

export function useTranscriptPages(args: {
  scrollRef: React.RefObject<HTMLDivElement | null>;
  conversationId: string;
  messages: CompanionMessage[];
  /** Gate paging until the panel has finished its initial load. */
  enabled: boolean;
}): UseTranscriptPagesResult {
  const { scrollRef, conversationId, messages, enabled } = args;

  const [loadingOlder, setLoadingOlder] = useState(false);
  // The oldest-message id we proved has nothing behind it. Compared
  // against the CURRENT oldest, so a transcript refetch (which can move
  // the anchor forward) automatically re-arms paging.
  const [exhaustedBeforeId, setExhaustedBeforeId] = useState<string | null>(null);

  // Mirrors so `loadOlder` stays a stable callback the scroll listener
  // can bind once.
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const conversationRef = useRef(conversationId);
  conversationRef.current = conversationId;
  const loadingRef = useRef(false);
  const exhaustedRef = useRef<string | null>(exhaustedBeforeId);
  exhaustedRef.current = exhaustedBeforeId;
  // Cursor carried forward when a page produced no VISIBLE message, so
  // the next attempt resumes past it instead of re-reading it. Valid only
  // while the anchor it was captured against is still the oldest message.
  const carryRef = useRef<{ anchorId: string; cursor: TranscriptCursor } | null>(null);

  const oldestId = messages[0]?.id ?? null;
  const exhausted = oldestId != null && exhaustedBeforeId === oldestId;

  const loadOlder = useCallback(() => {
    if (loadingRef.current) return;
    const current = messagesRef.current;
    const anchorId = current[0]?.id;
    if (!anchorId || exhaustedRef.current === anchorId) return;

    const carry = carryRef.current;
    const startCursor =
      carry && carry.anchorId === anchorId ? carry.cursor : cursorFromMessages(current);
    if (!startCursor) return;

    const conversation = conversationRef.current;
    const el = scrollRef.current;
    const prevHeight = el?.scrollHeight ?? 0;
    const prevTop = el?.scrollTop ?? 0;

    loadingRef.current = true;
    setLoadingOlder(true);

    void (async () => {
      try {
        let cursor: TranscriptCursor | null = startCursor;
        for (let i = 0; i < MAX_PAGES_PER_LOAD && cursor; i++) {
          const page: CompanionMessagePage = await companionListMessagesBefore({
            ...cursor,
            limit: TRANSCRIPT_PAGE_SIZE,
            conversationId: conversation,
          });
          // The user may have switched threads while this was in flight.
          if (conversationRef.current !== conversation) return;

          const next = cursorFromPage(page);
          if (page.messages.length > 0) {
            useCompanionStore.getState().prependMessages(page.messages);
            carryRef.current = null;
            if (page.exhausted) {
              // The newly-oldest message is the end of the line.
              setExhaustedBeforeId(page.messages[0]?.id ?? null);
            }
            return;
          }
          // Nothing visible in this page: remember where we got to so a
          // retry resumes, and keep walking.
          carryRef.current = next ? { anchorId, cursor: next } : null;
          if (page.exhausted) {
            setExhaustedBeforeId(anchorId);
            return;
          }
          cursor = next;
        }
      } catch (e) {
        silentCatch('companion_list_messages_before')(e);
      } finally {
        loadingRef.current = false;
        setLoadingOlder(false);
        // Keep the reading position stable: the prepended rows grew the
        // container above the viewport, so shift down by exactly that.
        // Next frame, after React has committed the new rows.
        requestAnimationFrame(() => {
          const node = scrollRef.current;
          if (!node) return;
          const grew = node.scrollHeight - prevHeight;
          if (grew > 0) node.scrollTop = prevTop + grew;
        });
      }
    })();
  }, [scrollRef]);

  // A thread switch invalidates every page-walk artifact.
  useEffect(() => {
    carryRef.current = null;
    setExhaustedBeforeId(null);
  }, [conversationId]);

  useEffect(() => {
    if (!enabled) return;
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      if (el.scrollTop <= LOAD_TRIGGER_PX) loadOlder();
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [enabled, scrollRef, loadOlder]);

  return { loadingOlder, exhausted, loadOlder };
}
