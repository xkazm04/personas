// External feeds into the live corner stack — messages that are NOT team-channel
// items (today: Notepad thread entries).
//
// Same shape as `liveDevHarness.ts`'s mock injection: a module-level pub/sub the
// overlay subscribes to, so the feeding feature pushes a render-ready
// `LiveMessage` and the fleet code never imports that feature. The one thing a
// feed adds beyond a message is its VERBS — inline actions, where a body click
// goes, what acknowledging it means — registered here under the message's
// `source`, so the stack can render them without knowing what they do.
//
// Deliberately dependency-free: `LiveChannelOverlay` is in the app's first
// chunk, and whatever it imports is paid for at boot. The notepad side (which
// lives in a lazy chunk) registers itself when it loads.
import type { ReactNode } from 'react';

import type { LiveMessage, LiveMessageSource } from './liveModel';

/** What a feed lends the stack for its own messages. */
export interface LiveSourceHandlers {
  /** Inline controls under the message body (verdict buttons, a reply field). */
  renderActions?: (m: LiveMessage) => ReactNode;
  /** A body click. Replaces the channel default (open Conversations). */
  open?: (m: LiveMessage) => void;
  /** The acknowledge button, AFTER the stack's own read ledger has recorded it. */
  acknowledge?: (m: LiveMessage) => void;
}

const messageSubs = new Set<(m: LiveMessage) => void>();
const sources = new Map<LiveMessageSource, LiveSourceHandlers>();

/** The overlay subscribes here; returns the unsubscribe. */
export function onExternalLiveMessage(cb: (m: LiveMessage) => void): () => void {
  messageSubs.add(cb);
  return () => {
    messageSubs.delete(cb);
  };
}

/** A feed pushes one message into the stack. No-op while no overlay listens. */
export function pushExternalLiveMessage(m: LiveMessage): void {
  for (const fn of [...messageSubs]) fn(m);
}

/** A feed registers its verbs; returns the unregister. */
export function registerLiveSource(source: LiveMessageSource, handlers: LiveSourceHandlers): () => void {
  sources.set(source, handlers);
  return () => {
    if (sources.get(source) === handlers) sources.delete(source);
  };
}

/** The verbs for a message's source, when a feed registered some. */
export function liveSourceFor(m: Pick<LiveMessage, 'source'>): LiveSourceHandlers | undefined {
  return m.source && m.source !== 'channel' ? sources.get(m.source) : undefined;
}

export function __resetLiveExternalForTests(): void {
  messageSubs.clear();
  sources.clear();
}
