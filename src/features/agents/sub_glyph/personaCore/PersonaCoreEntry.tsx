/** PersonaCoreEntry — the compose surface's door to the persona core.
 *
 *  The caller owns the state, via `usePersonaCore(buildSessionId)`, so it can
 *  read `core.state` / `core.preset` for the launch snapshot and reset on
 *  session change, and it owns the configurator: the Sheet · Cinema build
 *  surface opens `PersonaCoreBody` as a camera layer grown out of the badge
 *  (`onOpen` gets the badge element). A modal host existed until the core
 *  moved into that layer (2026-09-25); with `onOpen` required by the only
 *  caller it had not rendered since, so it is gone.
 */
import { PersonaCoreBadge } from "./PersonaCoreBadge";
import type { PersonaCore } from "./types";

export interface PersonaCoreEntryProps {
  core: PersonaCore;
  /** View-only while a build is in flight (mirrors the badge's own prop). */
  locked?: boolean;
  /** Entrance-stagger index handed to the badge. */
  index?: number;
  /** Open the configurator in the host's own surface. */
  onOpen: (el: HTMLElement) => void;
}

export function PersonaCoreEntry({ core, locked = false, index = 0, onOpen }: PersonaCoreEntryProps) {
  return <PersonaCoreBadge core={core} onOpen={onOpen} locked={locked} index={index} />;
}
