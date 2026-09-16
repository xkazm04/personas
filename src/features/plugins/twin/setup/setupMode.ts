/**
 * Which half of Setup the body is showing, and where that choice is kept.
 *
 * Its own module because the shell and the title row both need the type and
 * neither should import the other for it.
 */

import { safeLocalGet, safeLocalSet } from '@/lib/safeLocalStorage';

/** `guide` is the Desk (the default); `fields` is every slot typed directly. */
export type SetupMode = 'guide' | 'fields';

const MODE_KEY = 'twin.setup.mode';

/** Remembered per install: a user who works in Fields comes back to Fields. */
export function rememberedSetupMode(): SetupMode {
  return safeLocalGet(MODE_KEY, 'twin setup mode read') === 'fields' ? 'fields' : 'guide';
}

export function rememberSetupMode(mode: SetupMode): void {
  safeLocalSet(MODE_KEY, mode, 'twin setup mode write');
}
