// profileDraft — the sign-in settings dialog's draft, and the two pure rules it
// needs. The dialog edits a COPY of the account's link; nothing is written until
// Save, so Cancel is always a no-op.

import type { AccountLoginLink } from '@/lib/bindings/AccountLoginLink';

/** The select's value for "make a new profile here". Never a stored key (keys are slugs). */
export const NEW_PROFILE = '__new__';

export interface ProfileDraft {
  /** A stored profile key, `NEW_PROFILE`, or an empty string for none. */
  signIn: string;
  inbox: string;
  unattended: boolean;
  newLabel: string;
}

export function draftOf(link: AccountLoginLink | null): ProfileDraft {
  return {
    signIn: link?.profileKey ?? '',
    inbox: link?.codeInboxProfileKey ?? '',
    unattended: link?.reloginUnattended ?? false,
    newLabel: '',
  };
}

/** A profile key from the name the operator typed: lowercase slug, never empty for a non-blank name. */
export function profileKeyFromLabel(label: string): string {
  return label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
