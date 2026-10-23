// A proposal's one-line summary (PORTED from bp src/components/Queue.tsx bodySections / proposalSummary): the body's
// "Summary" section (else its first), its first sentence, at most 180 characters, and nothing when it only repeats the
// title. The store writes bodies as markdown sections; the card shows a sentence, never the markup.
const MAX_SUM = 180;

export function bodySections(body: string | undefined): { head: string; text: string }[] {
  const out: { head: string; text: string }[] = [];
  let cur: { head: string; lines: string[] } | null = null;
  const flush = () => { if (cur) { const text = cur.lines.join('\n').trim(); if (text) out.push({ head: cur.head, text }); } };
  for (const line of (body ?? '').split(/\r?\n/)) {
    const m = /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
    if (m) { flush(); cur = { head: m[1] ?? '', lines: [] }; } else { (cur ??= { head: 'Summary', lines: [] }).lines.push(line); }
  }
  flush();
  return out;
}

export function proposalSummary(title: string, body: string | undefined): string | null {
  const ss = bodySections(body), t = ss.find((s) => /^summary$/i.test(s.head))?.text ?? ss[0]?.text;
  if (!t) return null;
  const para = (t.split('\n')[0] ?? '').trim(), one = (/^.*?[.!?](?=\s|$)/.exec(para)?.[0] ?? para).replace(/\s+/g, ' ');
  const line = one.length > MAX_SUM ? one.slice(0, MAX_SUM - 1).trimEnd() + '…' : one;
  return !line || line.toLowerCase() === title.trim().toLowerCase() ? null : line;
}
