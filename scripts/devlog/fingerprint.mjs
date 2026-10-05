// The devlog fingerprint: the one stable identity of a log record across
// sessions, builds and machines. The Rust sink (src-tauri/src/logging.rs)
// computes the same value; `fp-vectors.json` beside this file is the contract
// both sides test against, so a change here without a regenerated vector file
// fails both test suites.
//
//   fp = fnv1a32(`${lvl}|${tgt}|${normalizeMessage(msg)}`)   as 8 lowercase hex
//   toolchain records: fnv1a32(`${lvl}|${tgt}|${code}|${file}`)
//
// Normalization strips the values a message should never have carried, so the
// 288 sites that still interpolate (structured-logging.md section 7 P5) group
// as one event instead of one per value. Every class is ASCII-only on purpose:
// JS and Rust disagree on what `\d`, `\w` and `\b` match outside ASCII.

const RULES = [
  [/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g, "<uuid>"],
  [/[A-Za-z]:[\\/][^\s"'<>|]*/g, "<path>"],
  [/\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+/g, "<path>"],
  [/"[^"]*"/g, "<s>"],
  [/`[^`]*`/g, "<s>"],
  [/[0-9a-fA-F]{8,}/g, "<hex>"],
  [/-?[0-9]+(?:\.[0-9]+)?/g, "<n>"],
];

/** Replace every value-shaped run in a message with its class token. */
export function normalizeMessage(msg) {
  let out = msg;
  for (const [re, token] of RULES) out = out.replace(re, token);
  return out;
}

/** FNV-1a 32-bit over the UTF-8 bytes of `text`, as 8 lowercase hex chars. */
export function fnv1a32(text) {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(text)) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/** Fingerprint of an application record (Rust or WebView source). */
export function fingerprint(lvl, tgt, msg) {
  return fnv1a32(`${lvl}|${tgt}|${normalizeMessage(msg)}`);
}

/** Fingerprint of a toolchain diagnostic (cargo, vite, tauri). */
export function toolchainFingerprint(lvl, tgt, code, file) {
  return fnv1a32(`${lvl}|${tgt}|${code ?? ""}|${file ?? ""}`);
}
