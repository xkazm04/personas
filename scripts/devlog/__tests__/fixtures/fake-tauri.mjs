// Stand-in for `tauri dev` in the wrapper test (DEVLOG_CHILD). Writes a known
// byte payload to stdout and stderr in awkward chunks (ANSI colour, a UTF-8
// character split across two writes, no trailing newline), records the
// session env it was given, and exits with FAKE_EXIT.

import fs from "node:fs";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

export const STDOUT_PAYLOAD = Buffer.concat([
  Buffer.from("\x1b[32m        Info\x1b[0m Watching for changes...\n"),
  Buffer.from("  VITE v8.0.16  ready in 512 ms\n"),
  Buffer.from("app says caf"),
  Buffer.from([0xc3]),
  Buffer.from([0xa9, 0x0a]),
  Buffer.from("       \x1b[31mError\x1b[0m [tauri_cli] boom happened\nno newline at end"),
]);

const cargo = fs.readFileSync(fileURLToPath(new URL("./cargo-output.txt", import.meta.url)));
export const STDERR_PAYLOAD = Buffer.concat([Buffer.from("\x1b[1m\x1b[33mwarning\x1b[0m\x1b[1m: unused import: `std::fs`\x1b[0m\n  --> src\\main.rs:1:5\n\n"), cargo]);

async function writeChunks(stream, buf, size) {
  for (let i = 0; i < buf.length; i += size) {
    stream.write(buf.subarray(i, i + size));
    await sleep(1);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url).toLowerCase() === path.resolve(process.argv[1]).toLowerCase()) {
  if (process.env.FAKE_SESSION_FILE) {
    fs.writeFileSync(process.env.FAKE_SESSION_FILE, JSON.stringify({ session: process.env.PERSONAS_DEVLOG_SESSION || null, args: process.argv.slice(2) }));
  }
  await writeChunks(process.stdout, STDOUT_PAYLOAD, 7);
  await writeChunks(process.stderr, STDERR_PAYLOAD, 53);
  process.exitCode = Number(process.env.FAKE_EXIT || 0);
}
