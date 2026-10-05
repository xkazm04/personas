// Turns the `tauri dev` terminal stream into toolchain records.
//
// What is recorded: cargo diagnostics (one record per `warning:`/`error:` block,
// with the first `--> file:line:col`), one `cargo.build` per `Finished ... in Xs`,
// tauri CLI `Error`/`Warn` lines, and Vite lines that reach the terminal BEFORE
// Vite reports `ready` (config and port failures the in-process plugin cannot
// see; after `ready` the plugin owns Vite diagnostics, so nothing is counted twice).
// Not recorded: progress (`Compiling`, `Checking`, ...) and the app's own stdout.
//
// One parser per stream: cargo writes diagnostics to stderr, and a block must
// not be split by a stdout line arriving between two of its lines.

import { normalizeMessage } from "../fingerprint.mjs";

const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*(?:\x07|\x1b\\)/g;

/** Remove ANSI escapes; parsing only, the terminal keeps its colours. */
export function stripAnsi(text) {
  return text.replace(ANSI, "");
}

const HEADER = /^(warning|error)(?:\[(E\d{4})\])?: (.*)$/;
const LOCATION = /^\s*--> (.+?):(\d+):(\d+)\s*$/;
const LINT = /#!?\[(?:warn|deny|forbid)\(([A-Za-z0-9_:]+)\)\]/;
const PROGRESS = /^\s+(Compiling|Checking|Finished|Running|Building|Fresh|Blocking|Downloaded|Downloading|Updating|Locking|Adding|Documenting|Packaging|Installing)\b/;
const FINISHED = /^\s*Finished\b(.*?)\bin\s+((?:\d+(?:\.\d+)?[hms]\s*)+)\s*$/;
const GENERATED = /^`[^`]+` \([^)]*\) generated \d+ warnings?/;
const COULD_NOT_COMPILE = /^could not compile `([^`]+)`/;
const TAURI = /^\s*(Error|Warn)\s+(.+)$/;
const VITE_READY = /\bVITE v\d[\w.-]*\s+ready in\b/;
const VITE_LINES = [
  { re: /error when starting dev server/i, lvl: "ERROR" },
  { re: /failed to load config from (\S+)/i, lvl: "ERROR", fileGroup: 1 },
  { re: /Port \d+ is already in use/i, lvl: "ERROR" },
  { re: /^✘ \[ERROR\] /, lvl: "ERROR" },
  { re: /\[vite\].*\berror\b/i, lvl: "ERROR" },
  { re: /\[vite\].*\bwarn(ing)?\b/i, lvl: "WARN" },
];

/** `1m 23s` / `23.45s` / `1h 2m 3s` -> seconds. */
export function parseCargoDuration(text) {
  let total = 0;
  for (const m of text.matchAll(/(\d+(?:\.\d+)?)([hms])/g)) {
    const n = Number(m[1]);
    total += m[2] === "h" ? n * 3600 : m[2] === "m" ? n * 60 : n;
  }
  return Math.round(total * 1000) / 1000;
}

/** A short, stable grouping code for a free-text line without one. */
function textCode(text) {
  return normalizeMessage(text).slice(0, 60);
}

/**
 * @param {{ emit: (draft: object) => void, state?: { viteReady: boolean } }} opts
 *   `emit` receives record drafts ({lvl, tgt, msg, file?, line?, f}); the
 *   caller stamps ts/src/boot/fp. `state` is shared between the stdout and
 *   stderr parsers so `ready` seen on either ends Vite capture for both.
 */
export function createToolchainParser({ emit, state = { viteReady: false } }) {
  let block = null;

  function flush() {
    if (!block) return;
    const b = block;
    block = null;
    const code = b.ecode ?? b.lint ?? (b.couldNotCompile ? "could_not_compile" : "");
    emit({
      lvl: b.lvl,
      tgt: "cargo",
      msg: b.lvl === "ERROR" ? "cargo.error" : "cargo.warning",
      file: b.file,
      line: b.line,
      f: { code, text: b.text, col: b.col, crate: b.crate },
    });
  }

  function cargoLine(line) {
    const header = HEADER.exec(line);
    if (header) {
      flush();
      const [, kind, ecode, text] = header;
      if (GENERATED.test(text) || /^build failed, waiting for other jobs/.test(text)) return true;
      const cnc = COULD_NOT_COMPILE.exec(text);
      block = {
        lvl: kind === "error" ? "ERROR" : "WARN",
        ecode,
        text: text.trim(),
        couldNotCompile: Boolean(cnc),
        crate: cnc ? cnc[1] : undefined,
      };
      return true;
    }
    const finished = FINISHED.exec(line);
    if (finished) {
      flush();
      const profile = /`([^`]+)` profile/.exec(finished[1]);
      emit({
        lvl: "INFO",
        tgt: "cargo",
        msg: "cargo.build",
        f: { duration_s: parseCargoDuration(finished[2]), profile: profile ? profile[1] : undefined },
      });
      return true;
    }
    if (PROGRESS.test(line)) {
      flush();
      return true;
    }
    if (!block) return false;
    if (line.trim() === "") {
      flush();
      return true;
    }
    const loc = LOCATION.exec(line);
    if (loc) {
      if (!block.file) {
        block.file = loc[1];
        block.line = Number(loc[2]);
        block.col = Number(loc[3]);
      }
      return true;
    }
    const lint = LINT.exec(line);
    if (lint && !block.lint) block.lint = lint[1];
    // Block continuation: indented, gutter (`12 |`), or a column-0 sub-note.
    if (/^\s/.test(line) || /^\d+\s*\|/.test(line) || /^(note|help)(\[\w+\])?:/.test(line)) return true;
    flush();
    return false;
  }

  function otherLine(line) {
    if (!state.viteReady && VITE_READY.test(line)) {
      state.viteReady = true;
      return;
    }
    const tauri = TAURI.exec(line);
    if (tauri) {
      const lvl = tauri[1] === "Error" ? "ERROR" : "WARN";
      const text = tauri[2].trim();
      emit({ lvl, tgt: "tauri", msg: `tauri.${lvl.toLowerCase()}`, f: { code: textCode(text), text } });
      return;
    }
    if (state.viteReady) return;
    for (const rule of VITE_LINES) {
      const m = rule.re.exec(line);
      if (!m) continue;
      const text = line.trim();
      emit({
        lvl: rule.lvl,
        tgt: "vite",
        msg: `vite.${rule.lvl.toLowerCase()}`,
        file: rule.fileGroup ? m[rule.fileGroup] : undefined,
        f: { code: textCode(text), text, via: "terminal" },
      });
      return;
    }
  }

  return {
    /** Feed one line (no trailing newline, ANSI allowed). */
    line(raw) {
      const line = stripAnsi(raw).replace(/\r$/, "");
      if (cargoLine(line)) return;
      otherLine(line);
    },
    /** End of stream: emit a block still open. */
    flush,
  };
}

/** Split a byte stream into lines, carrying the partial tail between chunks. */
export function createLineSplitter(onLine) {
  let tail = "";
  return {
    push(text) {
      const parts = (tail + text).split("\n");
      tail = parts.pop() ?? "";
      for (const p of parts) onLine(p);
    },
    end() {
      if (tail) onLine(tail);
      tail = "";
    },
  };
}
