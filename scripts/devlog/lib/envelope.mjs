// The JSONL envelope: one object per line, absent value = key omitted, keys in
// one fixed order so two writers produce comparable lines.
//
//   ts lvl src tgt file line msg fp boot span f
//
// Toolchain diagnostics (records that carry `f.code`) are fingerprinted by
// `toolchainFingerprint(lvl, tgt, code, file)`; every other record by
// `fingerprint(lvl, tgt, msg)`. Both come from fingerprint.mjs, never reimplemented.

import { fingerprint, toolchainFingerprint } from "../fingerprint.mjs";
import { isoMicros, slash } from "./paths.mjs";

export const LEVELS = ["ERROR", "WARN", "INFO", "DEBUG", "TRACE"];
const KEY_ORDER = ["ts", "lvl", "src", "tgt", "file", "line", "msg", "fp", "boot", "span", "f"];

function present(v) {
  if (v === undefined || v === null) return false;
  if (typeof v === "string" && v === "") return false;
  if (Array.isArray(v) && v.length === 0) return false;
  if (typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 0) return false;
  return true;
}

function compactFields(f) {
  if (!f) return undefined;
  const out = {};
  for (const [k, v] of Object.entries(f)) if (v !== undefined && v !== null) out[k] = v;
  return out;
}

/**
 * Build an envelope record. `fp` is computed unless given; `file` is stored
 * with forward slashes so the fingerprint of a toolchain diagnostic does not
 * depend on which OS printed it.
 */
export function makeRecord({ ts, lvl, src, tgt, file, line, msg, fp, boot, span, f }) {
  const fields = compactFields(f);
  const normFile = file ? slash(file) : undefined;
  let print = fp;
  if (!print) {
    print =
      fields && fields.code !== undefined
        ? toolchainFingerprint(lvl, tgt, fields.code, normFile ?? "")
        : fingerprint(lvl, tgt, msg ?? "");
  }
  const rec = { ts: ts ?? isoMicros(), lvl, src, tgt, file: normFile, line, msg, fp: print, boot, span, f: fields };
  const out = {};
  for (const k of KEY_ORDER) if (present(rec[k])) out[k] = rec[k];
  return out;
}

/** One JSONL line for a record. */
export function toLine(rec) {
  return JSON.stringify(rec) + "\n";
}
