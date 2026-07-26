/**
 * Structural test: every `#[tauri::command]` returns `Result<T, AppError>`.
 *
 * Codifies ADR stub 2026-05-10-result-string-to-apperror-migration. `AppError`
 * (src-tauri/src/error.rs) serialises to the structured IPC envelope
 * `{ error, kind, category, auto_fixable, failover_eligible }` (+ `details` for
 * `authorization_required`). A command that returns `Result<T, String>` instead
 * rejects with a bare string, so the frontend loses `kind`/`category` and every
 * consumer downstream — `errMsg`, `classifyError`, `toApiError`, the healing
 * engine's `auto_fixable` branch, `PendingAuthModal` — degrades to regex-
 * matching a message. This test is the drift gate: new `String`-returning
 * commands fail here rather than being discovered months later.
 *
 * Why a Vitest test and not a Rust test or a clippy lint: the Rust test
 * executables do not currently link on this Windows host (0xc0000139), and the
 * invariant is a plain source-text property that needs no type resolution.
 *
 * The allowlist below is exhaustive and every entry carries a reason. It is NOT
 * a place to park new work — adding a file to it requires the same
 * justification the existing entries carry. Shrinking it is always in scope.
 *
 * If this test fails: change the command's return type to
 * `Result<T, AppError>` and wrap the `String` errors from service methods at
 * the command boundary with the semantically right variant
 * (`AppError::Execution` / `Validation` / `External` / `ProcessSpawn` / …).
 * Then grep the frontend call sites — a site reading `e instanceof Error ?
 * e.message : String(e)` renders "[object Object]" against the envelope and
 * must switch to `errMsg()` from `@/stores/storeTypes`.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const RUST_SRC = resolve(__dirname, "../../../src-tauri/src");

/**
 * Files permitted to keep `Result<T, String>` commands, each with the reason.
 * Paths are POSIX-relative to `src-tauri/src`.
 */
const ALLOWLIST: Record<string, string> = {
  // Documented deliberate fork: the fleet IPC surface returns String on
  // purpose (its errors are terminal/session transport failures shaped for the
  // TUI driver, not app-domain errors). Revisiting it is a separate decision.
  "commands/fleet/commands.rs": "documented deliberate String fork (fleet)",
  "commands/fleet/process_scan.rs": "documented deliberate String fork (fleet)",
  "commands/fleet/transcript_read.rs": "documented deliberate String fork (fleet)",

  // (auto_cred_browser.rs and foraging.rs were migrated with their paired
  // frontend changes on 2026-07-26 — removed from this list per the
  // stale-entry rule: the list only shrinks.)

  // (dev_tools.rs's lone String command — the favicon probe — was migrated on
  // the architect-devtools branch; entry removed at merge per the shrink rule.)
};

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (entry.endsWith(".rs")) out.push(p);
  }
  return out;
}

/**
 * Given a return-type text containing `Result<...>`, return the LAST top-level
 * generic argument (the error type), or null when it cannot be determined.
 * Depth-tracked so `Result<HashMap<String, String>, AppError>` yields
 * `AppError` rather than the inner `String`.
 */
function resultErrorArg(returnType: string): string | null {
  const open = returnType.indexOf("Result<");
  if (open < 0) return null;
  const parts: string[] = [];
  let cur = "";
  let depth = 0;
  for (let i = open + "Result<".length; i < returnType.length; i++) {
    const c = returnType[i];
    if (c === "<" || c === "(" || c === "[") depth++;
    else if (c === ")" || c === "]") depth--;
    else if (c === ">") {
      if (depth === 0) {
        parts.push(cur);
        return parts.length >= 2 ? parts[parts.length - 1].trim() : null;
      }
      depth--;
    } else if (c === "," && depth === 0) {
      parts.push(cur);
      cur = "";
      continue;
    }
    cur += c;
  }
  return null;
}

interface CommandHit {
  file: string;
  fn: string;
  errorType: string;
}

function scanFile(absPath: string): CommandHit[] {
  const rel = relative(RUST_SRC, absPath).replace(/\\/g, "/");
  const lines = readFileSync(absPath, "utf8").split(/\r?\n/);
  const hits: CommandHit[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*#\[tauri::command/.test(lines[i])) continue;
    // Collect the signature: everything up to and including the line that
    // opens the body. Attributes and `#[cfg]` lines in between are harmless.
    let sig = "";
    for (let j = i + 1; j < Math.min(lines.length, i + 60); j++) {
      sig += lines[j] + "\n";
      if (lines[j].includes("{")) break;
    }
    const fnName = sig.match(/fn\s+([A-Za-z0-9_]+)/)?.[1] ?? "<unknown>";
    const returnType = sig.match(/->\s*([\s\S]*?)\s*\{/)?.[1]?.replace(/\s+/g, " ") ?? "";
    const errorType = resultErrorArg(returnType);
    if (errorType !== null) hits.push({ file: rel, fn: fnName, errorType });
  }
  return hits;
}

const allCommands = walk(RUST_SRC).flatMap(scanFile);
const stringCommands = allCommands.filter((c) => c.errorType === "String");

describe("structural: Tauri command error envelope", () => {
  it("discovers ≥400 fallible #[tauri::command] fns (sanity check on the scanner)", () => {
    // A regex/heuristic gate is only as good as its reach. If a refactor moves
    // commands somewhere this walk misses, the count collapses and this fails
    // loudly instead of the suite going vacuously green.
    expect(allCommands.length).toBeGreaterThanOrEqual(400);
  });

  it("every allowlist entry still has at least one String command (no stale entries)", () => {
    const withStringErrors = new Set(stringCommands.map((c) => c.file));
    const stale = Object.keys(ALLOWLIST).filter((f) => !withStringErrors.has(f));
    expect(
      stale,
      `Allowlisted files that no longer contain any Result<T, String> command — ` +
        `delete these entries so the allowlist keeps shrinking:\n` +
        stale.map((f) => `  - ${f}`).join("\n"),
    ).toEqual([]);
  });

  it("no #[tauri::command] outside the allowlist returns Result<T, String>", () => {
    const violations = stringCommands.filter((c) => !(c.file in ALLOWLIST));
    expect(
      violations,
      `Tauri commands returning Result<T, String> instead of Result<T, AppError>.\n` +
        `These bypass the structured IPC error envelope — see this file's header ` +
        `for the fix:\n` +
        violations.map((v) => `  - ${v.file}::${v.fn}`).join("\n"),
    ).toEqual([]);
  });
});
