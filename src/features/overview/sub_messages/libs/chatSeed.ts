import type { PersonaMessage } from '@/lib/types/types';
import type { PersonaManualReview } from '@/lib/bindings/PersonaManualReview';

/**
 * Build the auto-sent prompt that lands in Athena's composer when the
 * user clicks "Play in chat" on a message. Includes the persona, message
 * title, the message body, and any linked manual reviews so Athena can
 * compose a coherent summary that also covers pending decisions.
 *
 * Kept tiny + pure so the Playwright spec can import it directly to
 * verify what the composer should contain.
 */
export function buildSummariseChatPrompt(
  message: PersonaMessage,
  linkedReviews: PersonaManualReview[],
): string {
  const personaName = message.persona_name ?? 'this agent';
  const reviewBullets = linkedReviews
    .map((r) => `- Pending review: ${r.title} (${r.severity})`)
    .join('\n');

  return [
    `Please summarise the following persona execution for me.`,
    ``,
    `Persona: ${personaName}`,
    `Execution ID: ${message.execution_id ?? '(none)'}`,
    `Message title: ${message.title || '(untitled)'}`,
    ``,
    `--- Message content ---`,
    message.content || '(empty)',
    reviewBullets ? `\n--- Linked human reviews ---\n${reviewBullets}` : '',
    ``,
    `Cover: what the persona produced, anything notable, and any review actions pending.`,
  ].filter(Boolean).join('\n');
}
