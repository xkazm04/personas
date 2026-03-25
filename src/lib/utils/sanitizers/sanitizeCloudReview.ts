/**
 * Sanitize cloud review payloads before storing in state.
 *
 * Cloud review data crosses a trust boundary -- it originates from an external
 * system. A compromised cloud endpoint could push crafted content (misleading
 * instructions, social-engineering prompts, excessively long text). This module
 * validates expected shape, truncates to safe length, strips control characters,
 * and masks sensitive values.
 */

import { maskSensitiveJson } from './maskSensitive';

// -- Limits ----------------------------------------------------------------

/** Max length for the main content/payload text rendered in the UI. */
const MAX_CONTENT_LENGTH = 5_000;

/** Max length for the title derived from the payload. */
const MAX_TITLE_LENGTH = 120;

/** Max length for the response_message / reviewer_notes field. */
const MAX_NOTES_LENGTH = 2_000;

// -- Control character stripping ------------------------------------------

/**
 * Regex matching C0/C1 control characters EXCEPT common whitespace
 * (\t \n \r). Includes zero-width joiners, bidi overrides, and other
 * Unicode control characters commonly used in text spoofing attacks.
 */
const CONTROL_CHAR_RE =
  // eslint-disable-next-line no-control-regex
  /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F\u200B-\u200F\u2028-\u202E\uFEFF\uFFF9-\uFFFB]/g;

/** Strip dangerous control characters from a string. */
function stripControlChars(input: string): string {
  return input.replace(CONTROL_CHAR_RE, '');
}

// -- Payload coercion -----------------------------------------------------

/**
 * Coerce the raw `payload` field (typed as `unknown`) into a safe display
 * string. Handles string, object/array (JSON-stringified with sensitive
 * value masking), and other primitives.
 */
function coercePayloadToString(payload: unknown): string {
  if (payload == null) return '';
  if (typeof payload === 'string') return payload;
  if (typeof payload === 'number' || typeof payload === 'boolean') return String(payload);

  // Object/array -- stringify with sensitive-key masking
  try {
    const json = JSON.stringify(payload);
    return maskSensitiveJson(json) ?? json;
  } catch {
    return '[unreadable payload]';
  }
}

// -- Public API -----------------------------------------------------------

export interface SanitizedCloudReviewFields {
  content: string;
  title: string;
  reviewerNotes: string | null;
}

/**
 * Sanitize fields extracted from a cloud review payload before they are
 * stored in Zustand state and rendered in the UI.
 *
 * @param payload - The raw `payload` field from CloudReviewRequest (unknown type)
 * @param responseMessage - The raw `response_message` field (nullable string)
 * @returns Sanitized content, title, and reviewer notes safe for display
 */
export function sanitizeCloudReview(
  payload: unknown,
  responseMessage: string | null | undefined,
): SanitizedCloudReviewFields {
  // 1. Coerce to string and strip control characters
  let content = stripControlChars(coercePayloadToString(payload));

  // 2. Truncate to safe max length
  if (content.length > MAX_CONTENT_LENGTH) {
    content = content.slice(0, MAX_CONTENT_LENGTH) + '... [truncated]';
  }

  // 3. Derive a safe title from the first line of content
  let title = content
    ? content.split('\n')[0]!.slice(0, MAX_TITLE_LENGTH)
    : 'Cloud Review';
  title = title.trim() || 'Cloud Review';

  // 4. Sanitize reviewer notes
  let reviewerNotes: string | null = null;
  if (responseMessage != null) {
    reviewerNotes = stripControlChars(String(responseMessage));
    if (reviewerNotes.length > MAX_NOTES_LENGTH) {
      reviewerNotes = reviewerNotes.slice(0, MAX_NOTES_LENGTH) + '... [truncated]';
    }
  }

  return { content, title, reviewerNotes };
}
