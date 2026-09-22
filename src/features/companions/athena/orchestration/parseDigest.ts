/**
 * Parser for the backend's operative-memory digest text. The Rust side
 * formats orchestration state as a flat markdown blob (see
 * `OperativeMemory::digest_for_prompt` in
 * `src-tauri/src/companion/orchestration/operative_memory.rs`) that
 * Athena consumes as part of every prompt. The frontend used to render
 * the same blob in a `<pre>`; this parser pulls it into structured rows
 * so the strip can show per-op + per-session detail with collapsible
 * sections.
 *
 * Format (kept in sync with the Rust side):
 *
 *   ## Active orchestration (operative memory)
 *   - **<intent>** (`<id8>`, <status>, started 30s ago)
 *     - `<sess8>` "role": <state> → <tool>
 *       intent: <text>
 *       checkpoint: <text> · blockers: <text>
 *       files: <p1, p2, ...> (+3 more)
 *       ⚠ recent failure: <text>
 *       summary: <text>
 *
 * Defensive: any parse failure on a line is silently swallowed — the
 * caller can detect "parsed 0 ops" and fall back to the raw `<pre>` view.
 */

export interface ParsedSession {
  id8: string;
  role?: string;
  state: string;
  tool?: string;
  intent?: string;
  checkpoint?: string;
  blockers?: string;
  files?: string[];
  filesMore?: number;
  failure?: string;
  summary?: string;
}

export interface ParsedOp {
  intent: string;
  id8: string;
  status: string;
  duration: string;
  sessions: ParsedSession[];
}

export function parseDigest(digest: string): ParsedOp[] {
  const lines = digest.split('\n');
  const ops: ParsedOp[] = [];
  let currentOp: ParsedOp | null = null;
  let currentSession: ParsedSession | null = null;

  for (const raw of lines) {
    const line = raw.replace(/\r$/, '');
    if (!line.trim()) continue;

    // Op header: `- **<intent>** (`<id8>`, <status>, <duration>)`
    const opMatch = /^- \*\*(.+?)\*\* \(`([^`]+)`, ([^,]+),\s*(.+?)\)\s*$/.exec(
      line,
    );
    if (opMatch && opMatch[1] && opMatch[2] && opMatch[3] && opMatch[4]) {
      const op: ParsedOp = {
        intent: opMatch[1],
        id8: opMatch[2],
        status: opMatch[3].trim(),
        duration: opMatch[4].trim(),
        sessions: [],
      };
      currentOp = op;
      ops.push(op);
      currentSession = null;
      continue;
    }

    // Session header: `  - `<sess8>` "role": <state> → <tool>`  (role + tool optional)
    const sessMatch = /^ {2}- `([^`]+)`(?:\s+"([^"]+)")?:\s+(.+?)$/.exec(line);
    if (sessMatch && currentOp && sessMatch[1] && sessMatch[3]) {
      const tail = sessMatch[3];
      const arrowIdx = tail.indexOf(' → ');
      const state = arrowIdx >= 0 ? tail.slice(0, arrowIdx) : tail;
      const tool = arrowIdx >= 0 ? tail.slice(arrowIdx + 3) : undefined;
      const sess: ParsedSession = {
        id8: sessMatch[1],
        role: sessMatch[2],
        state: state.trim(),
        tool: tool?.trim(),
      };
      currentSession = sess;
      currentOp.sessions.push(sess);
      continue;
    }

    if (!currentSession) continue;

    // Indented session-detail lines (4 spaces).
    if (line.startsWith('    intent: ')) {
      currentSession.intent = line.slice('    intent: '.length).trim();
      continue;
    }
    if (line.startsWith('    checkpoint: ')) {
      const rest = line.slice('    checkpoint: '.length);
      const blockIdx = rest.indexOf(' · blockers: ');
      if (blockIdx >= 0) {
        currentSession.checkpoint = rest.slice(0, blockIdx).trim();
        currentSession.blockers = rest.slice(blockIdx + ' · blockers: '.length).trim();
      } else {
        currentSession.checkpoint = rest.trim();
      }
      continue;
    }
    if (line.startsWith('    files: ')) {
      const rest = line.slice('    files: '.length);
      const moreMatch = / \(\+(\d+) more\)\s*$/.exec(rest);
      const filesText = moreMatch ? rest.slice(0, moreMatch.index) : rest;
      currentSession.files = filesText
        .split(',')
        .map((p) => p.trim())
        .filter((p) => p.length > 0);
      if (moreMatch) currentSession.filesMore = Number(moreMatch[1]);
      continue;
    }
    if (line.startsWith('    ⚠ recent failure: ')) {
      currentSession.failure = line
        .slice('    ⚠ recent failure: '.length)
        .trim();
      continue;
    }
    if (line.startsWith('    summary: ')) {
      currentSession.summary = line.slice('    summary: '.length).trim();
      continue;
    }
  }

  return ops;
}
