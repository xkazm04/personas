// The one remote-approve gesture: a line of text into a blocked session's PTY.
//
// `FleetNeedsYouBanner`'s header calls this "the core remote-approve gesture
// the phone companion will mirror", and `FleetPairDevice` promises a paired
// phone allowlisted verdicts — but the gesture only existed inline in
// `FleetGridPage`, so the phone PREVIEW could not perform it and there was
// nothing for a second surface to mirror except a copied line of `writeInput`.
//
// One function, so a surface that sends a reply cannot drift into sending it
// differently: the trailing carriage return is what SUBMITS the line in the
// receiving terminal, and a reply without it leaves the session still blocked
// with the operator's answer sitting unsent on its prompt.

import { writeInput as writeInputApi } from '@/api/fleet/fleet';
import { toastCatch } from '@/lib/silentCatch';

/**
 * Send one line to a session's stdin. Resolves `true` when the write landed.
 *
 * Failure is toasted rather than thrown: every caller is a UI gesture, and a
 * silent failure here is the worst available outcome — the operator believes a
 * blocked agent has been answered and walks away.
 */
export async function replyToSession(
  sessionId: string,
  text: string,
  writeInput: (id: string, payload: string) => Promise<unknown> = writeInputApi,
): Promise<boolean> {
  try {
    await writeInput(sessionId, `${text}\r`);
    return true;
  } catch (e) {
    // No hardcoded fallback copy: without one `toastCatch` resolves the message
    // through the error registry, which is translated. The literal that used to
    // sit here shipped English to every locale.
    toastCatch('fleet:replyToSession')(e);
    return false;
  }
}
