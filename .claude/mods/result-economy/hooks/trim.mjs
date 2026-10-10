// Pure text policy for result-economy: a tool result's text in, the text the model should read out.
// No engine access; the hooks module and the tests both import this.

export const LIMITS = { maxLines: 300, maxChars: 30000, head: 80, tail: 120, lineChars: 2000 }

// Distinctive shapes only. A pattern loose enough to hit ordinary hex or base64 would
// corrupt the text an Edit must match exactly, so each of these names its own prefix.
const SECRETS = [
  { kind: 'anthropic-key', re: /sk-ant-[A-Za-z0-9_-]{20,}/g },
  { kind: 'github-token', re: /gh[pousr]_[A-Za-z0-9]{30,}/g },
  { kind: 'aws-access-key', re: /\bAKIA[0-9A-Z]{16}\b/g },
  { kind: 'private-key', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g },
  { kind: 'personas-local-token', re: /(x-personas-local-token:\s*)[0-9a-f]{32}/gi },
]

/** @returns {{ text: string, redacted: string[] }} */
export function redact(text) {
  const redacted = []
  let out = text
  for (const { kind, re } of SECRETS) {
    out = out.replace(re, (m, lead) => {
      redacted.push(kind)
      return `${typeof lead === 'string' ? lead : ''}[redacted:${kind}]`
    })
  }
  return { text: out, redacted }
}

/**
 * Keeps the head and the tail of a long result: logs put their cause and their
 * verdict at the two ends. Under the limits the text is returned untouched.
 * @returns {{ text: string, dropped: number }}
 */
export function trim(text, limits = LIMITS) {
  const capped = text.split('\n').map(l => (l.length > limits.lineChars ? `${l.slice(0, limits.lineChars)} [+${l.length - limits.lineChars} chars]` : l))
  const lines = capped.length
  const over = lines > limits.maxLines || text.length > limits.maxChars
  if (!over) return { text: capped.join('\n'), dropped: 0 }
  // Few but huge lines: nothing to drop by line count, so the per-line cap above already did the work.
  if (lines <= limits.head + limits.tail) return { text: capped.join('\n'), dropped: 0 }
  const dropped = lines - limits.head - limits.tail
  const marker = `[result-economy:${dropped} of ${lines} lines omitted from the middle; narrow the command or read the file for them]`
  return { text: [...capped.slice(0, limits.head), marker, ...capped.slice(lines - limits.tail)].join('\n'), dropped }
}

/** Redact first, so a token cannot survive in the kept head or tail, then trim. */
export function economize(text) {
  const r = redact(text)
  const t = trim(r.text)
  return { text: t.text, dropped: t.dropped, redacted: r.redacted, changed: t.dropped > 0 || r.redacted.length > 0 || t.text !== text }
}
