/**
 * The window's live bp follower (lens/bpFollower.ts): the bp_link doors as its source (spark roadmap S6). The follower
 * reads bp through Personas' Rust, never from the webview: the shipped CSP names no localhost, bp sends no CORS headers
 * and refuses the `tauri.localhost` origin. A place on another Personas product opens the drawing sheet at it
 * (`openLensSheet` with `place`). React-free.
 */
import { listBpProducts, moveBpFocus, readBpFocus } from '@/api/bpLink';
import type { FollowSource } from '../blueprint/source';
import { BpFollower } from './bpFollower';
import { openLensSheet } from './lensSheetStore';

/** bp's shared focus for this window, through the bp_link doors. One reader per window (`personas:<window>`). */
export function liveFollowSource(window = 'main'): FollowSource {
  return {
    reader: `personas:${window}`,
    read: async () => {
      const r = await readBpFocus();
      return { online: r.online, ...(r.view !== undefined ? { view: r.view } : {}), ...(r.error ? { error: r.error } : {}) };
    },
    move: (op) => moveBpFocus(window, op),
    products: async () => (await listBpProducts()).map((p) => ({ slug: p.slug, name: p.name, root: p.root, ...(p.projectId ? { projectId: p.projectId } : {}) })),
  };
}

let windowFollower: BpFollower | null = null;

/** The window's one follower, made on first use. */
export function liveFollower(): BpFollower {
  windowFollower ??= new BpFollower(liveFollowSource(), {
    open: (projectId, place) => openLensSheet({ kind: 'build', projectId, place }),
  });
  return windowFollower;
}
