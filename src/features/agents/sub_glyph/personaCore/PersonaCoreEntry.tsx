/** PersonaCoreEntry — badge + modal in one mountable unit.
 *
 *  The badge is the ONLY door to `PersonaCoreModal`, and until this existed it
 *  was hand-wired per surface (badge here, modal there, an `open` state in
 *  between), and a compose surface that skipped the wiring silently lost the
 *  whole Codex - no badge, no disabled state, nothing. A surface that wants
 *  the Codex now mounts one component.
 *
 *  The caller still owns the state, via `usePersonaCore(buildSessionId)`, so
 *  it can read `core.state` / `core.preset` for the launch snapshot and reset
 *  on session change.
 *
 *  A host that shows the configurator itself (the Sheet · Cinema build surface
 *  opens it as a camera layer grown out of the badge) passes `onOpen`: the
 *  entry then renders the badge alone and hands it the click.
 */
import { useState } from "react";

import { PersonaCoreBadge } from "./PersonaCoreBadge";
import { PersonaCoreModal } from "./PersonaCoreModal";
import type { PersonaCore } from "./types";

export interface PersonaCoreEntryProps {
  core: PersonaCore;
  /** View-only while a build is in flight (mirrors the badge's own prop). */
  locked?: boolean;
  /** Entrance-stagger index handed to the badge. */
  index?: number;
  /** Open the configurator in the host's own surface instead of the modal. */
  onOpen?: (el: HTMLElement) => void;
}

export function PersonaCoreEntry({ core, locked = false, index = 0, onOpen }: PersonaCoreEntryProps) {
  const [open, setOpen] = useState(false);
  if (onOpen) return <PersonaCoreBadge core={core} onOpen={onOpen} locked={locked} index={index} />;
  return (
    <>
      <PersonaCoreBadge core={core} onOpen={() => setOpen(true)} locked={locked} index={index} />
      <PersonaCoreModal core={core} isOpen={open} onClose={() => setOpen(false)} />
    </>
  );
}
