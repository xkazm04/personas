// clang-path - put LLVM's bin directory on a cargo child's PATH when clang is installed but not on PATH.
//
// Why: on aarch64-pc-windows-msvc the `ring` crate's build script compiles C with clang
// (cc-rs: "failed to find tool \"clang\""), so `npm run tauri:dev` and `npm run test:rust` died in
// the dependency build - before a line of Personas compiled - on any ARM64 Windows machine whose
// LLVM install never reached PATH (measured 2026-10-30 on Lynx: exit 101 at 441/817, clang at
// C:\Program Files\LLVM\bin). scripts/desktop-dev.ps1 already repaired this for its own session;
// the two Node chokepoints every other lane uses (scripts/devlog/run.mjs for `tauri dev*`,
// scripts/build/cargo-run.mjs for every other cargo call) did not.
//
// Contract: clangPathEnv(env) -> {} when nothing needs doing, or { [pathKey]: "<llvm bin>;<old PATH>" }
// to merge into the child env. It never touches the caller's env and never invents an install:
// only an existing clang.exe in $LLVM_BIN or the default LLVM location is added. Windows env keys
// are case-insensitive but a spread copy of process.env is not, so the EXISTING key ("Path" on
// Windows) is reused - writing a second "PATH" key would hand the child two conflicting values.
import { existsSync } from "node:fs";
import { join, delimiter as DEFAULT_DELIMITER } from "node:path";

export const DEFAULT_LLVM_BIN = "C:\\Program Files\\LLVM\\bin";

/**
 * @param {Record<string, string | undefined>} env the child's environment (not mutated)
 * @param {{ platform?: string, exists?: (p: string) => boolean, delimiter?: string }} [deps] injectable for tests
 * @returns {{ add: Record<string, string>, note?: string }}
 */
export function clangPathEnv(env, deps = {}) {
  const platform = deps.platform ?? process.platform;
  const exists = deps.exists ?? existsSync;
  const delimiter = deps.delimiter ?? (platform === "win32" ? ";" : DEFAULT_DELIMITER);
  if (platform !== "win32") return { add: {} };
  const pathKey = Object.keys(env).find((k) => k.toLowerCase() === "path") ?? "Path";
  const current = env[pathKey] ?? "";
  const dirs = current.split(delimiter).filter(Boolean);
  if (dirs.some((d) => exists(join(d, "clang.exe")))) return { add: {} };
  const candidates = [env.LLVM_BIN, DEFAULT_LLVM_BIN].filter(Boolean);
  const bin = candidates.find((d) => exists(join(d, "clang.exe")));
  if (!bin) return { add: {} };
  return {
    add: { [pathKey]: current ? `${bin}${delimiter}${current}` : bin },
    note: `clang was not on PATH; using ${bin} for this build (ring needs it on ARM64 Windows)`,
  };
}
