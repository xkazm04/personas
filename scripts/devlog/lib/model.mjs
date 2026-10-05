// The in-memory model every subcommand works from: all records of the logs
// dir (retention bounds it to about a week), the sessions they belong to, and
// the selection rules (`--session`, `--since`, `--walk`, profile filter).

import { fingerprint, fnv1a32 } from "../fingerprint.mjs";
import { scanLogs } from "./reader.mjs";

const SLOW_DB = "Slow DB query detected";

/** Parse `24h`, `7d`, `90m`, `30s` into ms. */
export function parseDuration(text) {
  const m = /^(\d+(?:\.\d+)?)\s*([smhdw])$/.exec(String(text).trim());
  if (!m) throw new Error(`bad duration "${text}" (use e.g. 90m, 24h, 7d)`);
  const unit = { s: 1e3, m: 6e4, h: 3.6e6, d: 8.64e7, w: 6.048e8 }[m[2]];
  return Number(m[1]) * unit;
}

/**
 * Which digest bucket a record belongs to. Perf-shaped records are pulled out
 * of the level buckets so a slow query is not ALSO a repeating warning.
 */
export function classify(r) {
  if (r.src === "toolchain") {
    if (r.tgt === "devlog") return "meta";
    if (r.tgt === "cargo" && r.msg === "cargo.build") return "build";
    return "toolchain";
  }
  const tgt = r.tgt ?? "";
  if (tgt.startsWith("webview::")) {
    const kind = tgt.slice(9);
    if (kind === "ipc_slow" || kind === "ipc_window") return "ipc";
    if (kind === "long_task" || kind === "commit") return "render";
    if (kind === "swallow_rollup") return "swallow";
  }
  if (r.msg === SLOW_DB) return "db";
  if (r.msg === "span.close") return "span";
  if (r.msg === "log.suppressed") return "suppressed";
  if (r.msg === "boot.start") return "boot";
  if (r.lvl === "ERROR") return "error";
  if (r.lvl === "WARN") return "warn";
  return "info";
}

/**
 * The derived identity of a perf group (one command, one table/op, one
 * route...). Perf records share a constant msg, so their own fp cannot tell
 * two commands apart; `show --fp` and `diff` accept these as well.
 */
export function perfKey(r) {
  const f = r.f ?? {};
  const tgt = r.tgt ?? "";
  let section;
  let key;
  if (tgt === "webview::ipc_slow" || tgt === "webview::ipc_window") [section, key] = ["ipc", f.command];
  else if (tgt === "webview::long_task") [section, key] = ["long_task", f.route ?? "-"];
  else if (tgt === "webview::commit") [section, key] = ["commit", f.profiler_id ?? "-"];
  else if (tgt === "webview::swallow_rollup") [section, key] = ["swallow", f.tag ?? "-"];
  else if (r.msg === SLOW_DB) [section, key] = ["db", `${f.table ?? "-"} ${f.operation ?? "-"}`];
  else if (r.msg === "span.close") [section, key] = ["span", f.span ?? (r.span ?? []).at(-1) ?? "-"];
  else return null;
  if (key === undefined || key === null) return null;
  return { section, key: String(key), fp: fnv1a32(`perf|${section}|${key}`) };
}

function newSession(id, r) {
  return {
    id,
    kind: r.src === "toolchain" ? "toolchain" : r._legacy ? "legacy" : "boot",
    start: r._t,
    last: r._t,
    profile: r._legacy ? "unknown" : undefined,
    counts: {},
    records: 0,
  };
}

/** Load every record and derive sessions. */
export async function loadModel(logsDir) {
  const records = [];
  const stats = await scanLogs(logsDir, (r) => {
    if (Number.isFinite(r._t)) records.push(r);
  });
  records.sort((a, b) => a._t - b._t);
  const sessions = new Map();
  for (const r of records) {
    if (!r.fp) r.fp = fingerprint(r.lvl ?? "", r.tgt ?? "", r.msg ?? "");
    r._class = classify(r);
    const id = r.boot ?? "unknown";
    let s = sessions.get(id);
    if (!s) sessions.set(id, (s = newSession(id, r)));
    if (r._t < s.start) s.start = r._t;
    if (r._t > s.last) s.last = r._t;
    s.counts[r.lvl] = (s.counts[r.lvl] ?? 0) + 1;
    s.records += 1;
    const f = r.f ?? {};
    if (r.msg === "boot.start" && r.src !== "toolchain") {
      s.kind = "boot";
      s.profile = f.profile;
      s.version = f.version;
      s.devlogSession = f.devlog_session;
      s.gitSha = f.git_sha;
      s.start = r._t;
    } else if (r.src === "toolchain" && r.tgt === "devlog" && r.msg === "session.start") {
      s.script = f.script;
      s.gitSha = f.git_sha;
      s.start = r._t;
    } else if (r.src === "toolchain" && r.msg === "walk.start" && !s.script) {
      s.script = "walk";
    }
  }
  for (const s of sessions.values()) if (s.kind !== "toolchain" && !s.profile) s.profile = "unknown";
  return { records, sessions, stats, logsDir };
}

const isApp = (s) => s && (s.kind === "boot" || s.kind === "legacy");
/** Dev-comparable: debug builds plus legacy/unknown (the text log never said). */
export const isDevProfile = (s) => s && s.profile !== "release";

/** App sessions, newest first, honouring the profile filter. */
export function appSessions(model, { allProfiles = false } = {}) {
  return [...model.sessions.values()]
    .filter((s) => isApp(s) && (allProfiles || isDevProfile(s)))
    .sort((a, b) => b.start - a.start);
}

function findSession(model, id) {
  if (model.sessions.has(id)) return model.sessions.get(id);
  const hits = [...model.sessions.values()].filter((s) => s.id.startsWith(id));
  if (hits.length === 1) return hits[0];
  if (hits.length > 1) throw new Error(`session "${id}" is ambiguous (${hits.length} matches)`);
  return null;
}

function findWalk(model, walkId) {
  let start = null;
  let end = null;
  let last = null;
  for (const r of model.records) {
    if (r.src !== "toolchain" || r.tgt !== "devlog") continue;
    const id = r.f?.walk_id;
    if (!id || !(id === walkId || id.startsWith(walkId))) continue;
    if (r.msg === "walk.start") start = r;
    if (r.msg === "walk.end") end = r;
    last = r;
  }
  if (!start) return null;
  return { id: start.f.walk_id, start: start._t, end: (end ?? last)._t };
}

/**
 * Resolve a selection into the records it covers.
 * @returns {{ records, label, from, to, focus, walk }}
 */
export function select(model, { session, since, walk, allProfiles = false, now = Date.now() } = {}) {
  const profileOk = (r) => {
    if (allProfiles || r.src === "toolchain") return true;
    return isDevProfile(model.sessions.get(r.boot ?? "unknown"));
  };
  if (walk) {
    const w = findWalk(model, walk);
    if (!w) throw new Error(`walk "${walk}" not found in the toolchain log`);
    // +2.5 s: the WebView flushes its buffer every 2 s, so the tail of the
    // last section lands just after walk.end.
    const to = w.end + 2500;
    const records = model.records.filter((r) => r._t >= w.start && r._t <= to && profileOk(r));
    return { records, label: `walk ${w.id}`, from: w.start, to, focus: newestApp(model, records), walk: w };
  }
  if (session) {
    let s;
    if (session === "last") {
      s = appSessions(model, { allProfiles })[0] ?? newestToolchain(model);
      if (!s) throw new Error("no sessions in the logs dir");
    } else {
      s = findSession(model, session);
      if (!s) throw new Error(`session "${session}" not found`);
    }
    const ids = new Set([s.id]);
    if (s.devlogSession) ids.add(s.devlogSession);
    if (s.kind === "toolchain") {
      for (const o of model.sessions.values()) if (o.devlogSession === s.id) ids.add(o.id);
    }
    const records = model.records.filter((r) => ids.has(r.boot ?? "unknown") && profileOk(r));
    const focus = isApp(s) ? s : newestApp(model, records);
    return { records, label: `session ${s.id}`, from: s.start, to: s.last, focus };
  }
  const span = parseDuration(since ?? "24h");
  const from = now - span;
  const records = model.records.filter((r) => r._t >= from && r._t <= now && profileOk(r));
  return { records, label: `since ${since ?? "24h"}`, from, to: now, focus: newestApp(model, records) };
}

function newestApp(model, records) {
  let best = null;
  for (const r of records) {
    const s = model.sessions.get(r.boot ?? "unknown");
    if (isApp(s) && (!best || s.start > best.start)) best = s;
  }
  return best;
}

function newestToolchain(model) {
  return [...model.sessions.values()].filter((s) => s.kind === "toolchain").sort((a, b) => b.start - a.start)[0] ?? null;
}

/** The app session before `focus` with a comparable profile, or null. */
export function previousSession(model, focus, { allProfiles = false } = {}) {
  if (!focus) return null;
  const devFocus = isDevProfile(focus);
  return (
    appSessions(model, { allProfiles: true })
      .filter((s) => s.start < focus.start && s.id !== focus.id)
      .find((s) => allProfiles || isDevProfile(s) === devFocus) ?? null
  );
}

/** boot id -> Set of WARN/ERROR fps (and perf-group fps) it produced. */
export function fpsBySession(model) {
  const out = new Map();
  for (const r of model.records) {
    if (r.lvl !== "WARN" && r.lvl !== "ERROR") continue;
    const id = r.boot ?? "unknown";
    let set = out.get(id);
    if (!set) out.set(id, (set = new Set()));
    set.add(r.fp);
    const pk = perfKey(r);
    if (pk) set.add(pk.fp);
  }
  return out;
}
