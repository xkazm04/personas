// Dev-only Vite plugin: Vite's own warnings and errors, HMR error payloads and
// full-reload storms become toolchain records (tgt `vite`) in
// `<logs>/toolchain.YYYY-MM-DD.jsonl`. Nothing Vite prints changes: the
// logger methods are wrapped, the original runs first, recording happens after.
//
// - logger: `config.logger.warn/warnOnce/error` (every environment logger
//   delegates to these at call time, vite/dist/node/chunks/node.js).
// - HMR: `server.ws.send` is the client environment's hot channel; `error`
//   payloads (the overlay) are recorded unless the logger just recorded the
//   same message, and `full-reload` payloads are counted per minute: more than
//   5 in a minute writes one WARN `vite.reload_storm`.
// - session: records carry `boot` = PERSONAS_DEVLOG_SESSION (set by
//   scripts/devlog/run.mjs and inherited through `tauri dev` -> `npm run dev`),
//   else a session of the plugin's own, opened with a `session.start`.
// Inert under vitest. Registered in vite.config.ts for `command === 'serve'`.

import { randomUUID } from "node:crypto";
import { makeRecord } from "./lib/envelope.mjs";
import { resolveLogsDir } from "./lib/paths.mjs";
import { stripAnsi } from "./lib/toolchain-parser.mjs";
import { JsonlWriter } from "./lib/writer.mjs";
import { normalizeMessage } from "./fingerprint.mjs";

const STORM_PER_MIN = 5;
const DEDUPE_MS = 2000;

/** Fields of a Vite/Rollup error: plugin, id, file, line. */
export function errorFields(err) {
  if (!err || typeof err !== "object") return {};
  const loc = err.loc ?? {};
  const id = typeof err.id === "string" ? err.id.split("?")[0] : undefined;
  return {
    plugin: typeof err.plugin === "string" ? err.plugin : undefined,
    id,
    file: typeof loc.file === "string" ? loc.file : id,
    line: Number.isFinite(loc.line) ? loc.line : undefined,
    col: Number.isFinite(loc.column) ? loc.column : undefined,
    errCode: typeof err.code === "string" ? err.code : undefined,
  };
}

/**
 * The recorder behind the plugin, separate so tests can drive it without Vite.
 * @param {{ write: (rec: object) => void, now?: () => number, session?: string }} opts
 */
export function createViteRecorder({ write, now = () => Date.now(), session }) {
  const recent = new Map();
  let reloads = [];
  let stormOpenUntil = 0;

  function emit(lvl, msg, text, fields) {
    const firstLine = stripAnsi(String(text ?? "")).split("\n").find((l) => l.trim()) ?? "";
    const { file, line, col, plugin, id, errCode } = fields;
    const code = errCode ?? plugin ?? normalizeMessage(firstLine.trim()).slice(0, 60);
    write(
      makeRecord({
        lvl,
        src: "toolchain",
        tgt: "vite",
        msg,
        file,
        line,
        boot: session,
        f: { code, text: firstLine.trim().slice(0, 500), plugin, id, col, via: fields.via },
      }),
    );
  }

  function remember(text) {
    const key = stripAnsi(String(text ?? "")).trim().slice(0, 200);
    recent.set(key, now());
    for (const [k, t] of recent) if (now() - t > DEDUPE_MS) recent.delete(k);
    return key;
  }

  return {
    log(type, msg, opts) {
      const err = opts?.error;
      const fields = { ...errorFields(err), via: "logger" };
      const text = err?.message ?? msg;
      if (err?.message) remember(err.message);
      remember(msg);
      emit(type === "error" ? "ERROR" : "WARN", type === "error" ? "vite.error" : "vite.warning", text, fields);
    },
    hmr(payload) {
      if (!payload || typeof payload !== "object") return;
      if (payload.type === "error") {
        const err = payload.err ?? {};
        const key = stripAnsi(String(err.message ?? "")).trim().slice(0, 200);
        const seen = recent.get(key);
        if (seen !== undefined && now() - seen <= DEDUPE_MS) return;
        remember(err.message);
        emit("ERROR", "vite.hmr_error", err.message, { ...errorFields(err), via: "hmr" });
      } else if (payload.type === "full-reload") {
        const t = now();
        reloads = reloads.filter((x) => t - x < 60_000);
        reloads.push(t);
        if (reloads.length > STORM_PER_MIN && t >= stormOpenUntil) {
          stormOpenUntil = t + 60_000;
          write(
            makeRecord({
              lvl: "WARN",
              src: "toolchain",
              tgt: "vite",
              msg: "vite.reload_storm",
              boot: session,
              f: { reloads_per_min: reloads.length, triggered_by: typeof payload.triggeredBy === "string" ? payload.triggeredBy : undefined },
            }),
          );
        }
      }
    },
  };
}

export function devlogVitePlugin() {
  let recorder = null;
  return {
    name: "devlog",
    apply: "serve",
    configResolved(config) {
      if (process.env.VITEST || config.command !== "serve") return;
      try {
        // Lazy: a config load that never logs (tooling resolving the config)
        // writes nothing, not even its own session.start.
        let writer = null;
        const wrapped = process.env.PERSONAS_DEVLOG_SESSION;
        const session = wrapped || randomUUID();
        const write = (rec) => {
          if (!writer) {
            writer = new JsonlWriter(resolveLogsDir());
            if (!wrapped) writer.write(makeRecord({ lvl: "INFO", src: "toolchain", tgt: "devlog", msg: "session.start", boot: session, f: { script: "vite", cwd: process.cwd(), node: process.version } }));
          }
          writer.write(rec);
        };
        recorder = createViteRecorder({ write, session });
        const logger = config.logger;
        const warnedOnce = new Set();
        for (const type of ["warn", "warnOnce", "error"]) {
          const original = logger[type].bind(logger);
          logger[type] = (msg, opts) => {
            original(msg, opts);
            try {
              if (type === "warnOnce") {
                if (warnedOnce.has(msg)) return;
                warnedOnce.add(msg);
              }
              recorder.log(type === "error" ? "error" : "warn", msg, opts);
            } catch {
              /* recording must never change what Vite does */
            }
          };
        }
      } catch {
        recorder = null;
      }
    },
    configureServer(server) {
      if (!recorder || !server.ws || typeof server.ws.send !== "function") return;
      const send = server.ws.send.bind(server.ws);
      server.ws.send = (...args) => {
        const result = send(...args);
        try {
          if (typeof args[0] === "object") recorder.hmr(args[0]);
        } catch {
          /* never let recording break HMR */
        }
        return result;
      };
    },
  };
}
