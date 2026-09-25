/**
 * Speech-shaping helpers for the chat panel's TTS paths.
 */

/**
 * Flatten markdown to speakable plain text so TTS never reads `**` / `-` / `#`
 * aloud. Lightweight (no parser) — strips the common inline/structural marks.
 */
export function stripMarkdownForSpeech(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, ' ')             // fenced code
    .replace(/`([^`]+)`/g, '$1')                  // inline code
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')    // links/images → text
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')           // headings
    .replace(/^\s*[-*+]\s+/gm, '')                // bullet markers
    .replace(/^\s*\d+\.\s+/gm, '')                // ordered markers
    .replace(/[*_]{1,3}([^*_]+)[*_]{1,3}/g, '$1') // bold/italic
    .replace(/[*_~>]/g, '')                       // stray marks
    .replace(/\n{2,}/g, '. ')                     // paragraph breaks → pause
    .replace(/\s+/g, ' ')
    .trim();
}
