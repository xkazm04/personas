// Fingerprint contract, cargo/tauri/Vite terminal parser, legacy text parser.
// Run: node --test scripts/devlog/__tests__
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { fingerprint, normalizeMessage, toolchainFingerprint } from "../fingerprint.mjs";
import { makeRecord } from "../lib/envelope.mjs";
import { createLegacyParser, parseLegacyBody, splitFields } from "../lib/legacy.mjs";
import { createLineSplitter, createToolchainParser, parseCargoDuration, stripAnsi } from "../lib/toolchain-parser.mjs";

const fixture = (name) => fs.readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), "utf8");

test("fingerprint matches every vector in fp-vectors.json", () => {
  const v = JSON.parse(fs.readFileSync(fileURLToPath(new URL("../fp-vectors.json", import.meta.url)), "utf8"));
  assert.ok(v.app.length > 0 && v.toolchain.length > 0);
  for (const c of v.app) {
    assert.equal(normalizeMessage(c.msg), c.norm, `norm of ${c.msg}`);
    assert.equal(fingerprint(c.lvl, c.tgt, c.msg), c.fp, `fp of ${c.msg}`);
  }
  for (const c of v.toolchain) assert.equal(toolchainFingerprint(c.lvl, c.tgt, c.code, c.file), c.fp);
});

test("envelope omits absent keys and keeps the frozen key order", () => {
  const r = makeRecord({ ts: "2026-10-05T00:00:00.000001Z", lvl: "WARN", src: "toolchain", tgt: "cargo", msg: "cargo.warning", file: "src\\a.rs", line: 3, boot: "b", f: { code: "unused", text: "x", col: undefined } });
  assert.deepEqual(Object.keys(r), ["ts", "lvl", "src", "tgt", "file", "line", "msg", "fp", "boot", "f"]);
  assert.equal(r.file, "src/a.rs");
  assert.deepEqual(r.f, { code: "unused", text: "x" });
  assert.equal(r.fp, toolchainFingerprint("WARN", "cargo", "unused", "src/a.rs"));
  const plain = makeRecord({ ts: "t", lvl: "INFO", src: "toolchain", tgt: "devlog", msg: "session.start" });
  assert.equal(plain.fp, fingerprint("INFO", "devlog", "session.start"));
  assert.ok(!("f" in plain) && !("span" in plain));
});

function parseText(text) {
  const out = [];
  const state = { viteReady: false };
  const parser = createToolchainParser({ emit: (d) => out.push(d), state });
  const split = createLineSplitter((l) => parser.line(l));
  split.push(text);
  split.end();
  parser.flush();
  return out;
}

test("cargo parser: one record per diagnostic block, code from lint or E-code, first location only", () => {
  const recs = parseText(fixture("cargo-output.txt"));
  const diags = recs.filter((r) => r.tgt === "cargo" && r.msg !== "cargo.build");
  assert.deepEqual(
    diags.map((r) => [r.lvl, r.f.code, r.file, r.line]),
    [
      ["WARN", "unused_variables", "src\\engine\\kp_reporter.rs", 412],
      ["WARN", "clippy::if_same_then_else", "db\\src\\perf.rs", 250],
      ["ERROR", "E0308", "src\\commands\\core\\personas.rs", 42],
      ["ERROR", "could_not_compile", undefined, undefined],
    ],
  );
  assert.equal(diags[0].f.text, "unused variable: `elapsed`");
  assert.equal(diags[3].f.crate, "app");
  const builds = recs.filter((r) => r.msg === "cargo.build");
  assert.equal(builds.length, 1);
  assert.deepEqual(builds[0].f, { duration_s: 83, profile: "dev" });
  assert.ok(!recs.some((r) => /Compiling/.test(JSON.stringify(r))), "progress lines are not recorded");
});

test("cargo parser strips ANSI for parsing", () => {
  const colored = "\x1b[1m\x1b[33mwarning\x1b[0m\x1b[1m: unused import: `std::fs`\x1b[0m\n\x1b[1m\x1b[94m  --> \x1b[0msrc\\main.rs:1:5\n\n";
  const recs = parseText(colored);
  assert.equal(recs.length, 1);
  assert.equal(recs[0].file, "src\\main.rs");
  assert.equal(recs[0].f.text, "unused import: `std::fs`");
  assert.equal(stripAnsi("\x1b[31mred\x1b[0m"), "red");
});

test("cargo durations", () => {
  assert.equal(parseCargoDuration("1m 23s"), 83);
  assert.equal(parseCargoDuration("23.45s"), 23.45);
  assert.equal(parseCargoDuration("1h 2m 3s"), 3723);
});

test("tauri lines always; Vite terminal lines only before `ready`", () => {
  const recs = parseText(fixture("tauri-vite-output.txt"));
  assert.deepEqual(
    recs.map((r) => [r.tgt, r.lvl]),
    [
      ["vite", "ERROR"],
      ["vite", "ERROR"],
      ["tauri", "WARN"],
      ["tauri", "ERROR"],
    ],
  );
  assert.match(recs[1].f.text, /Port 1420 is already in use/);
  assert.equal(recs[1].f.via, "terminal");
  assert.match(recs[3].f.text, /beforeDevCommand/);
  assert.ok(!recs.some((r) => /updating dependencies/.test(r.f.text)), "post-ready Vite lines belong to the plugin");
});

test("line splitter carries partial lines across chunks", () => {
  const lines = [];
  const s = createLineSplitter((l) => lines.push(l));
  s.push("ab");
  s.push("c\nde");
  s.push("f\n");
  s.push("tail");
  s.end();
  assert.deepEqual(lines, ["abc", "def", "tail"]);
});

test("splitFields: constant message, quoted and spaced values", () => {
  assert.deepEqual(splitFields("KP report push failed what=\"rollup\" error=error sending request"), {
    msg: "KP report push failed",
    f: { what: "rollup", error: "error sending request" },
  });
  assert.deepEqual(splitFields('nested reason="a b=c" n=5'), { msg: "nested", f: { reason: "a b=c", n: 5 } });
  assert.deepEqual(splitFields("no fields here"), { msg: "no fields here", f: undefined });
});

test("parseLegacyBody: spans, absolute dependency paths, no-file records", () => {
  const nested = parseLegacyBody('outer{id=7}:inner: app_lib::engine::x: src\\engine\\x.rs:10: nested span event reason="a b=c" n=5');
  assert.deepEqual(nested.span, ["outer", "inner"]);
  assert.equal(nested.tgt, "app_lib::engine::x");
  assert.equal(nested.line, 10);
  const dep = parseLegacyBody("tauri_runtime_wry: C:\\Users\\dev\\.cargo\\registry\\src\\idx\\tauri-runtime-wry-2.11.2\\src\\lib.rs:3780: WebView2 error: boom");
  assert.equal(dep.tgt, "tauri_runtime_wry");
  assert.equal(dep.msg, "WebView2 error: boom");
  const bare = parseLegacyBody("some::target: a message");
  assert.deepEqual([bare.tgt, bare.msg, bare.file], ["some::target", "a message", undefined]);
});

test("legacy parser: boots, continuation lines, WebView double-write dropped", () => {
  const p = createLegacyParser({ day: "2026-10-05" });
  const recs = [];
  for (const line of fixture("legacy.log").split("\n")) {
    const r = p.line(line);
    if (r) recs.push(r);
  }
  const last = p.end();
  if (last) recs.push(last);

  assert.equal(recs[0].boot, "legacy:2026-10-05", "records before the first marker keep the carried/day boot");
  assert.equal(recs[1].boot, "legacy:2026-10-05T06:41:02.462161Z");
  const kp = recs[0];
  assert.equal(kp.fp, fingerprint("WARN", "app_lib::engine::kp_reporter", "KP report push failed"));
  assert.equal(kp.file, "src/engine/kp_reporter.rs");
  const table = recs.find((r) => r.f?.detail?.includes("Startup Timing"));
  assert.equal(table.msg, "=== Startup Timing ===");
  assert.match(table.f.detail, /db_init\s+59098ms/);
  const alerts = recs.filter((r) => r.tgt === "webview::store_alert");
  assert.equal(alerts.length, 1, "raw [WebView/...] line is the duplicate of the tracing line");
  assert.equal(alerts[0].src, "webview");
  assert.equal(alerts[0].file, undefined, "the bridge is not the producer's callsite");
  assert.match(alerts[0].f.detail, /HEAP GROWTH/);
  const span = recs.find((r) => r.tgt === "app_lib::engine::x");
  assert.deepEqual(span.span, ["outer", "inner"]);
  assert.deepEqual(span.f, { reason: "a b=c", n: 5 });
  assert.ok(recs.every((r) => /^[0-9a-f]{8}$/.test(r.fp)));
});
