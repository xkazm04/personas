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

/**
 * Extract an incremental text chunk from a `stream_event` line (emitted when
 * the CLI runs with `--include-partial-messages`). These arrive token-by-token
 * *before* the final whole `assistant` message, so appending them gives the
 * bubble a live, flowing fill instead of whole-message jumps.
 *
 * Shape:
 *   {"type":"stream_event","event":{"type":"content_block_delta",
 *     "delta":{"type":"text_delta","text":"Hel"}}}
 *
 * Returns '' for any non-text delta (tool-input `input_json_delta`,
 * block start/stop, message start/stop, thinking deltas) — those carry no
 * visible prose. When deltas have streamed for a turn, the caller must skip
 * the duplicate text from the trailing whole `assistant` message.
 */
export function extractAssistantTextDelta(line: string): string {
  try {
    const json = JSON.parse(line);
    if (json?.type !== 'stream_event') return '';
    const ev = json?.event;
    if (ev?.type !== 'content_block_delta') return '';
    const delta = ev?.delta;
    if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
      return delta.text;
    }
    return '';
  } catch {
    return '';
  }
}
