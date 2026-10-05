// Reader for the pre-JSONL text log, `personas.YYYY-MM-DD.log`:
//
//   2026-10-04T00:00:26.857196Z  INFO [span: ]target: file:line: message k=v k2="v"
//   [2026-10-04T10:38:01.811] [WebView/warn] message          (local time, no Z)
//   <continuation lines with no timestamp>
//
// Every line becomes the same envelope a JSONL record has, so the first digest
// has the week of history that predates the sink. Three decisions:
// - `[WebView/...]` raw lines are DROPPED with their continuations. Their only
//   writer, `log_frontend_error`, also emits the same message through tracing
//   (target `webview`) with a UTC stamp and a callsite, so keeping both would
//   count every frontend alert twice.
// - tracing `webview` records are given the kind the JSONL sink will use
//   (`webview::store_alert`, `webview::freeze`, else `webview::error`/`::log`)
//   so coverage and sections read old and new records alike.
// - boots: `File logging enabled at` (src/logging.rs) is the first line every
//   boot writes, so it starts a pseudo-boot `legacy:<UTC stamp>`. Records
//   before any marker carry the previous file's boot over midnight.

import { fingerprint } from "../fingerprint.mjs";

const HEADER = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)\s+(ERROR|WARN|INFO|DEBUG|TRACE)\s+(.*)$/;
const WEBVIEW_RAW = /^\[\d{4}-\d{2}-\d{2}T[\d:.]+\] \[WebView\/\w+\] /;
const WITH_FILE = /^(?:(.*?): )?([A-Za-z_][A-Za-z0-9_]*(?:::[A-Za-z0-9_]+)*): ((?:[A-Za-z]:)?[^\s:]+?\.rs):(\d+):(?: (.*))?$/;
// Fast path first: most lines carry no span prefix, and the lazy span group
// of WITH_FILE backtracks through every ": " of the message to find out.
const WITH_FILE_NO_SPAN = /^([A-Za-z_][A-Za-z0-9_]*(?:::[A-Za-z0-9_]+)*): ((?:[A-Za-z]:)?[^\s:]+?\.rs):(\d+):(?: (.*))?$/;
const NO_FILE = /^(?:(.*?): )?([A-Za-z_][A-Za-z0-9_]*(?:::[A-Za-z0-9_]+)*): (.*)$/;
const FIELD = / ([A-Za-z_][A-Za-z0-9_.]*)=/g;
const BOOT_MARKER = "File logging enabled at";
const DETAIL_CAP = 4096;

// A week of text repeats a few messages tens of thousands of times; the
// fingerprint (normalize + hash) is computed once per distinct triple.
const FP_MEMO = new Map();
function memoFingerprint(lvl, tgt, msg) {
  const key = `${lvl}|${tgt}|${msg}`;
  let fp = FP_MEMO.get(key);
  if (fp === undefined) {
    if (FP_MEMO.size > 50_000) FP_MEMO.clear();
    fp = fingerprint(lvl, tgt, msg);
    FP_MEMO.set(key, fp);
  }
  return fp;
}

function coerce(value) {
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  if (value === "true") return true;
  if (value === "false") return false;
  return value;
}

/** Split `message k=v k2="v w"` into the constant message and its fields. */
export function splitFields(text) {
  FIELD.lastIndex = 0;
  let m = FIELD.exec(text);
  if (!m) return { msg: text, f: undefined };
  const msg = text.slice(0, m.index);
  const f = {};
  while (m) {
    const key = m[1];
    const start = m.index + m[0].length;
    if (text[start] === '"') {
      let i = start + 1;
      while (i < text.length && text[i] !== '"') i += text[i] === "\\" ? 2 : 1;
      const raw = text.slice(start, i + 1);
      try {
        f[key] = JSON.parse(raw);
      } catch {
        f[key] = raw.slice(1, -1);
      }
      FIELD.lastIndex = i + 1;
      m = FIELD.exec(text);
    } else {
      FIELD.lastIndex = start;
      const next = FIELD.exec(text);
      f[key] = coerce(text.slice(start, next ? next.index : text.length));
      m = next;
    }
  }
  return { msg, f };
}

/** `outer{a=1}:inner` -> ["outer", "inner"] */
function spanNames(prefix) {
  if (!prefix) return undefined;
  const names = [];
  let depth = 0;
  let cur = "";
  for (const ch of prefix) {
    if (ch === "{") depth += 1;
    else if (ch === "}") depth -= 1;
    else if (ch === ":" && depth === 0) {
      if (cur.trim()) names.push(cur.trim());
      cur = "";
      continue;
    }
    if (depth === 0 && ch !== "}") cur += ch;
  }
  if (cur.trim()) names.push(cur.trim());
  return names.length ? names : undefined;
}

function webviewKind(lvl, msg, detail) {
  const text = `${msg}\n${detail ?? ""}`;
  if (/STORE ALERT/.test(text)) return "webview::store_alert";
  if (/FREEZE/.test(text)) return "webview::freeze";
  return lvl === "ERROR" ? "webview::error" : "webview::log";
}

/** Parse the part after the level into target, callsite, spans, message, fields. */
export function parseLegacyBody(body) {
  let m = WITH_FILE_NO_SPAN.exec(body);
  if (m) {
    const [, tgt, file, line, rest = ""] = m;
    return { tgt, file, line: Number(line), ...splitFields(rest) };
  }
  m = WITH_FILE.exec(body);
  if (m) {
    const [, spans, tgt, file, line, rest = ""] = m;
    return { span: spanNames(spans), tgt, file, line: Number(line), ...splitFields(rest) };
  }
  m = NO_FILE.exec(body);
  if (m) {
    const [, spans, tgt, rest] = m;
    return { span: spanNames(spans), tgt, ...splitFields(rest) };
  }
  return { tgt: "unknown", msg: body, f: undefined };
}

/**
 * Stateful line parser. `line()` returns the record the PREVIOUS header line
 * started once it is complete (continuations attached), else null; call
 * `end()` after the last line. `carryBoot` continues a boot across files.
 */
export function createLegacyParser({ day, carryBoot } = {}) {
  let pending = null;
  let skipping = false;
  let boot = carryBoot ?? `legacy:${day ?? "unknown"}`;

  function finish() {
    const p = pending;
    pending = null;
    if (!p) return null;
    let msg = p.msg ?? "";
    const f = p.f ? { ...p.f } : {};
    if (p.detail.length) {
      const detail = p.detail.join("\n");
      f.detail = detail.length > DETAIL_CAP ? detail.slice(0, DETAIL_CAP) : detail;
      if (!msg.trim()) msg = p.detail[0];
    }
    let tgt = p.tgt;
    let src = "rust";
    if (tgt === "webview") {
      src = "webview";
      f.legacy_tgt = "webview";
      tgt = webviewKind(p.lvl, msg, f.detail);
    }
    const rec = { ts: p.ts, lvl: p.lvl, src, tgt, msg, fp: memoFingerprint(p.lvl, tgt, msg), boot: p.boot };
    // A legacy WebView record's callsite is the Rust bridge that relayed it
    // (frontend_bridge.rs), not its producer; omitted rather than misleading.
    if (p.file && src === "rust") rec.file = p.file.replace(/\\/g, "/");
    if (p.line && src === "rust") rec.line = p.line;
    if (p.span) rec.span = p.span;
    if (Object.keys(f).length) rec.f = f;
    return rec;
  }

  return {
    get boot() {
      return boot;
    },
    line(raw) {
      const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
      const h = HEADER.exec(line);
      if (h) {
        skipping = false;
        const done = finish();
        const body = parseLegacyBody(h[3]);
        if (body.tgt === "app_lib::logging" && body.msg.startsWith(BOOT_MARKER)) boot = `legacy:${h[1]}`;
        pending = { ts: h[1], lvl: h[2], ...body, boot, detail: [] };
        return done;
      }
      if (WEBVIEW_RAW.test(line)) {
        skipping = true;
        return finish();
      }
      if (skipping) return null;
      if (pending && line.trim() !== "") pending.detail.push(line);
      return null;
    },
    end() {
      return finish();
    },
  };
}
