/**
 * Best-effort extraction of assistant text from a stream-json line. Claude
 * Code emits multiple line types; we only care about assistant content
 * blocks of type `text`. Anything we can't parse is silently skipped (the
 * raw line is still useful as a "thinking" indicator at the panel level).
 */
export function extractAssistantText(line: string): string {
  try {
    const json = JSON.parse(line);
    if (json?.type !== 'assistant') return '';
    const blocks = json?.message?.content;
    if (!Array.isArray(blocks)) return '';
    let out = '';
    for (const b of blocks) {
      if (b?.type === 'text' && typeof b.text === 'string') {
        out += b.text;
      }
    }
    return out;
  } catch {
    return '';
  }
}
