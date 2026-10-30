// clang-path: ring's build script needs clang on ARM64 Windows; an installed-but-unlisted LLVM goes
// onto the cargo child's PATH, nothing else changes. Run: npm run test:devlog
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { clangPathEnv, DEFAULT_LLVM_BIN } from "../../build/clang-path.mjs";

const win = (have) => ({ platform: "win32", delimiter: ";", exists: (p) => have.includes(p) });
const clangIn = (dir) => join(dir, "clang.exe");

test("installed LLVM that is not on PATH is prepended, under the EXISTING Path key", () => {
  const env = { Path: "C:\\Windows\\system32;C:\\tools" };
  const r = clangPathEnv(env, win([clangIn(DEFAULT_LLVM_BIN)]));
  assert.deepEqual(Object.keys(r.add), ["Path"], "never a second PATH key beside Windows' Path");
  assert.equal(r.add.Path, `${DEFAULT_LLVM_BIN};C:\\Windows\\system32;C:\\tools`);
  assert.match(r.note, /clang was not on PATH/);
  assert.equal(env.Path, "C:\\Windows\\system32;C:\\tools", "the caller's env is not mutated");
});

test("clang already on PATH: nothing changes", () => {
  const r = clangPathEnv({ Path: `D:\\llvm\\bin;C:\\x` }, win([clangIn("D:\\llvm\\bin"), clangIn(DEFAULT_LLVM_BIN)]));
  assert.deepEqual(r, { add: {} });
});

test("LLVM_BIN wins over the default location", () => {
  const r = clangPathEnv({ PATH: "C:\\x", LLVM_BIN: "E:\\llvm\\bin" }, win([clangIn("E:\\llvm\\bin"), clangIn(DEFAULT_LLVM_BIN)]));
  assert.equal(r.add.PATH, "E:\\llvm\\bin;C:\\x");
});

test("no install anywhere: nothing is invented (cc-rs then reports the real gap)", () => {
  assert.deepEqual(clangPathEnv({ Path: "C:\\x" }, win([])), { add: {} });
});

test("non-Windows hosts are untouched", () => {
  assert.deepEqual(clangPathEnv({ PATH: "/usr/bin" }, { platform: "linux", exists: () => true }), { add: {} });
});
