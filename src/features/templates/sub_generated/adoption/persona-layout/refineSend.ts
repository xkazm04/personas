import { silentCatch } from '@/lib/silentCatch';

// Send-and-restore for the adoption refine composer.
//
// The composer closes and clears the moment the user presses Send. If the send
// then fails, the feedback they typed would be gone with nothing to retry, so a
// refine that reports `false` (or throws) hands the text back to be reopened.

/** `false` means "not sent"; anything else (including `undefined`) means sent. */
export type RefineHandler = (prompt: string) => void | boolean | Promise<void | boolean>;

export async function sendRefine(
  text: string,
  onRefine: RefineHandler | undefined,
  restore: (text: string) => void,
): Promise<void> {
  try {
    const sent = await onRefine?.(text);
    if (sent === false) restore(text);
  } catch (err) {
    silentCatch('adoption:refineSend')(err);
    restore(text);
  }
}
