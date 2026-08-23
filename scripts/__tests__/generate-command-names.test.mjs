#!/usr/bin/env node
// Tests for scripts/generate-command-names.mjs — the Tauri command-name codegen.
//
// The point of these is Wave 1 of the Rust refactor: lib.rs is about to be
// split, and the ~1,934-line `generate_handler![ ... ]` list will move and may
// be split into several invocations. Each case below builds a synthetic
// src-tauri/src tree in the OS temp dir, points `discoverCommandNames()` at it,
// and asserts the parser survives a shape it has never seen in this repo.
//
// Run:  node scripts/__tests__/generate-command-names.test.mjs

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { discoverCommandNames } from '../generate-command-names.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');

let passed = 0;
let failed = 0;
const failures = [];

function expect(label, cond, detail) {
  if (cond) {
    passed++;
  } else {
    failed++;
    failures.push(`${label}${detail ? `\n    ${detail}` : ''}`);
  }
}

function eq(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  expect(label, a === e, `expected ${e}\n    actual   ${a}`);
}

/** Build a throwaway src tree from {relPath: contents} and scan it. */
function scanFixture(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cmdnames-'));
  try {
    for (const [rel, contents] of Object.entries(files)) {
      const full = path.join(dir, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, contents, 'utf-8');
    }
    return discoverCommandNames(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// 1. The list is no longer in lib.rs, and no longer wrapped the same way.
// ---------------------------------------------------------------------------
{
  const { names, blocks } = scanFixture({
    'lib.rs': 'pub fn run() { app.invoke_handler(handlers::all()).run(ctx); }\n',
    'handlers/mod.rs': `pub fn all<R: Runtime>() -> impl Fn(Invoke<R>) -> bool {
    some_other_wrapper(tauri::generate_handler![
        greet,
        commands::core::personas::list_personas,
    ])
}
`,
  });
  eq('relocated list: names found', names, ['greet', 'list_personas']);
  eq('relocated list: one block, in handlers/mod.rs', blocks.map((b) => b.file), ['handlers/mod.rs']);
}

// ---------------------------------------------------------------------------
// 2. THE WAVE-1 SHAPE: the list is split across several files AND several
//    `generate_handler!` invocations, composed per domain.
// ---------------------------------------------------------------------------
{
  const flat = scanFixture({
    'lib.rs': `fn run() {
    .invoke_handler(ipc_auth::wrap_invoke_handler(tauri::generate_handler![
        greet,
        commands::core::personas::list_personas,
        commands::vault::credentials::list_credentials,
        commands::recipes::crud::get_recipe,
    ]))
}
`,
  });

  const split = scanFixture({
    'lib.rs': `fn run() {
    .invoke_handler(ipc_auth::wrap_invoke_handler(handlers::registry()))
}
`,
    'handlers/core.rs': `pub fn core<R: Runtime>() -> Handler<R> {
    tauri::generate_handler![
        greet,
        commands::core::personas::list_personas,
    ]
}
`,
    // Two separate invocations in ONE file — also a legal outcome of the split.
    'handlers/domains.rs': `pub fn vault<R: Runtime>() -> Handler<R> {
    tauri::generate_handler![
        commands::vault::credentials::list_credentials,
    ]
}

pub fn recipes<R: Runtime>() -> Handler<R> {
    tauri::generate_handler![
        commands::recipes::crud::get_recipe,
    ]
}
`,
  });

  eq(
    'split list: same four commands as the flat list',
    split.names,
    flat.names,
  );
  eq('split list: three blocks discovered', split.blocks.length, 3);
  eq(
    'split list: blocks attributed to the right files',
    split.blocks.map((b) => `${b.file}:${b.count}`),
    ['handlers/core.rs:2', 'handlers/domains.rs:1', 'handlers/domains.rs:1'],
  );
  eq('split list: nothing unparseable', split.rejects, []);
}

// ---------------------------------------------------------------------------
// 3. An unbalanced `[` inside a COMMENT inside the list. This is the live shape
//    at lib.rs:2428, and it defeats a raw bracket scan.
// ---------------------------------------------------------------------------
{
  const { names, rejects } = scanFixture({
    'lib.rs': `fn run() {
    tauri::generate_handler![
        greet,
        // this comment mentions \`#[cfg(\` and is missing its closing bracket
        commands::core::personas::list_personas,
    ]
}

fn after_the_list() -> usize { 42 }
`,
  });
  eq('unbalanced bracket in comment: list still terminates', names, ['greet', 'list_personas']);
  eq('unbalanced bracket in comment: no junk parsed', rejects, []);
}

// ---------------------------------------------------------------------------
// 4. `generate_handler![` appearing as a STRING LITERAL inside a #[cfg(test)]
//    module must not be mistaken for a registration list.
// ---------------------------------------------------------------------------
{
  const { names, blocks } = scanFixture({
    'lib.rs': `fn run() {
    tauri::generate_handler![
        greet,
    ]
}

#[cfg(test)]
mod structural_tests {
    fn body() -> String {
        let start = src.find("generate_handler![").expect("must contain generate_handler![ list");
        src[start..].to_string()
    }
}
`,
  });
  eq('string literal in cfg(test): only the real list is a block', blocks.length, 1);
  eq('string literal in cfg(test): names unaffected', names, ['greet']);
}

// ---------------------------------------------------------------------------
// 5. Test files that carry no #[cfg(test)] attribute are skipped by name.
// ---------------------------------------------------------------------------
{
  const { names } = scanFixture({
    'lib.rs': `tauri::generate_handler![ greet, ]\n`,
    'commands/dev_tools_backlog_tests.rs': `tauri::generate_handler![ never_registered, ]\n`,
    'tests/fixtures.rs': `tauri::generate_handler![ also_never_registered, ]\n`,
  });
  eq('test files skipped', names, ['greet']);
}

// ---------------------------------------------------------------------------
// 6. A line inside the list that is not a Rust path is reported, not silently
//    dropped — the old parser turned `.build(tauri::generate_context!())` into
//    a plausible-looking command name.
// ---------------------------------------------------------------------------
{
  const { names, rejects } = scanFixture({
    'lib.rs': `tauri::generate_handler![
    greet,
    #[cfg(feature = "ml")]
    commands::ml::embed,
    .build(tauri::generate_context!()),
]
`,
  });
  eq('cfg-gated entry kept', names.includes('embed'), true);
  eq('non-path line rejected', rejects.length, 1);
}

// ---------------------------------------------------------------------------
// 7. The real repo: the scan must still find the live list, above the floor,
//    and agree exactly with the committed generated file.
// ---------------------------------------------------------------------------
{
  const { names, blocks, rejects } = discoverCommandNames(
    path.join(REPO_ROOT, 'src-tauri', 'src'),
  );
  expect('repo: at least one handler block', blocks.length >= 1, `blocks=${blocks.length}`);
  eq('repo: nothing unparseable', rejects, []);
  expect('repo: above the floor', names.length >= 1400, `found ${names.length}`);

  const generated = fs.readFileSync(
    path.join(REPO_ROOT, 'src', 'lib', 'commandNames.generated.ts'),
    'utf-8',
  );
  const committed = [...generated.matchAll(/^\s*\|\s*"([\w]+)"/gm)].map((m) => m[1]);
  eq('repo: scan matches the committed generated union', names, committed);
}

// ---------------------------------------------------------------------------

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('\nFailures:\n' + failures.map((f) => `  - ${f}`).join('\n'));
  process.exit(1);
}
