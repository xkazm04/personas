/**
 * Convert a Creative Session's raw output lines (the same `[You] ...`,
 * `[Tool] ...`, `[Creative] ...`, `[Error] ...`, `[System] ...` strings
 * the OutputLine renderer reads) into Markdown that pastes cleanly into
 * a doc or a chat. Consecutive [Tool] lines are folded into a single
 * fenced code block so a 50-line tool transcript becomes one block, not
 * 50 separate quotes.
 */
export function sessionOutputToMarkdown(lines: string[]): string {
  const parts: string[] = [];
  let toolBuf: string[] = [];

  const flushTool = () => {
    if (toolBuf.length === 0) return;
    parts.push('```tool\n' + toolBuf.join('\n') + '\n```');
    toolBuf = [];
  };

  for (const raw of lines) {
    if (raw.startsWith('[Tool]')) {
      toolBuf.push(raw.replace(/^\[Tool\]\s*/, ''));
      continue;
    }
    flushTool();
    if (raw.startsWith('[You]')) {
      parts.push(`**You:** ${raw.replace(/^\[You\]\s*/, '')}`);
    } else if (raw.startsWith('[Creative]') || raw.startsWith('[Complete]')) {
      parts.push(`> ✓ ${raw.replace(/^\[(Creative|Complete)\]\s*/, '')}`);
    } else if (raw.startsWith('[Error]')) {
      parts.push(`> ❌ ${raw.replace(/^\[Error\]\s*/, '')}`);
    } else if (raw.startsWith('[System]')) {
      parts.push(`_${raw.replace(/^\[System\]\s*/, '')}_`);
    } else {
      parts.push(raw);
    }
  }
  flushTool();
  return parts.join('\n\n');
}
