# Build memory: where the 6 GB actually goes

Measured 2026-07-27 on `app_lib` (`--features desktop`), after
`cargo clean -p personas-desktop`, sampled 1/s with
[`scripts/build/sample-build-memory.ps1`](../../scripts/build/sample-build-memory.ps1).
All figures are **peak resident memory of the single largest `rustc` process**,
which is the number that matters — one process is what takes a machine down,
not the sum.

## The measurements

| build | peak single rustc | wall | vs baseline |
|---|---|---|---|
| `cargo check --lib` | **4,242 MB** | 169 s | −36% |
| `cargo build --lib` (dev profile, as configured) | **6,583 MB** | 212 s | baseline |
| `cargo build --lib -j 2` | **5,807 MB** | 229 s | −12% |
| `cargo build --lib`, dev `debug = 0` | **6,179 MB** | 207 s | −6% |
| `cargo build --lib`, `CARGO_INCREMENTAL=0` | **7,597 MB** | 204 s | **+15%** |
| `cargo test --lib --no-run` (test profile, `debug = 0`) | 5,920 MB | ~300 s | −10% |

## Three findings that change what to do about it

### 1. `cargo test` is NOT the expensive step. The ordinary dev build is.

The long-standing note that "`cargo test` is the 8 GB step" was an artefact of
only ever measuring that command. As configured today the plain
`cargo build --lib` peaks **higher** (6,583 MB vs 5,920 MB) — the test profile
sets `debug = 0` while the dev profile keeps `line-tables-only`.

`tauri dev` and `tauri build` go through the dev/release profiles. That is what
actually costs 6.5 GB, and it runs far more often than the test build.

### 2. Two thirds of the peak is the rustc FRONTEND, which no flag can touch.

`cargo check` runs macro expansion, name resolution, type-checking, MIR
building and monomorphization collection, then stops. It peaks at **4,242 MB** —
**64% of the full build's peak**. LLVM codegen accounts for the other ~2,341 MB.

Frontend memory scales with how much code is in ONE crate. No codegen flag,
profile setting or parallelism knob reduces it. **Splitting the crate is the
only lever.** That is why the crate split moved the number (8,872 → 6,201 MB at
matched debuginfo) and why the remaining wins are also structural.

### 3. `CARGO_INCREMENTAL=0` is a pessimisation here — measured, not assumed.

The usual advice is that incremental compilation costs memory. On this crate it
*saves* 1 GB (7,597 → 6,583 MB), because incremental mode partitions into many
small codegen units that can be freed as they are emitted, whereas
non-incremental merges them into fewer, larger LLVM modules. Do not "optimise"
by turning it off.

## What to do

**Structural — the only thing that moves the 4.2 GB frontend:**

`app_lib` is still 265k LOC. The two large remaining pieces are `commands`
(~123k) and the ~88k of `engine/` that did not move. Both are blocked on the
same thing: `AppState` holds `cloud`, `gitlab` and `commands` types, so it
cannot move down, and ~25 engine modules reference it. The fix is a **context
trait** — declare in `personas-engine` the narrow accessors the engine actually
needs, implement it for `AppState` in `app_lib` — not another file move.
Extracting `commands` would put `app_lib` near 142k, which should roughly halve
the frontend share.

### `tauri::generate_handler!` — 10% of the memory, but HALF the time

Measured by temporarily gutting the handler list from 1,827 entries to 8 and
re-running `cargo check --lib`:

| | peak single rustc | wall |
|---|---|---|
| full handler (1,827 entries) | 4,242 MB | 169 s |
| gutted to 8 entries | 3,803 MB | **86 s** |
| delta | **−439 MB (−10%)** | **−83 s (−49%)** |

So it is **not** the memory hotspot — 439 MB of a 4,242 MB frontend peak. The
remaining 3.8 GB is spread across the 265k LOC, which confirms that splitting is
the only lever for memory.

But it is **half of `cargo check`'s wall time**, in one macro invocation. That
matters because `check` is the routine gate that runs constantly. Tauri allows
only one `invoke_handler`, so this cannot simply be split into several calls;
reducing it means reducing the *number of commands* (1,529 `#[tauri::command]`
attributes today), e.g. by consolidating families of related commands behind one
command taking an action enum. That is a design change, not a build flag, and
worth costing separately.

**Free, today, no code change:**

- Use `cargo check` for routine validation — 36% less memory and 20% faster.
  Already the project's practice; this quantifies why.
- On a memory-constrained machine, `-j 2` buys −12% for +8% wall time.
- Setting dev `debug = 0` buys −6%, at the cost of line numbers in backtraces.
  Probably not worth it; `line-tables-only` is already the cheap tier.
- Do **not** set `CARGO_INCREMENTAL=0`.

**Already banked:** `core` → `db` → `engine` → `app_lib` means editing the
engine no longer rebuilds `db` or `core`. Day-to-day rebuild scope shrank even
where the peak did not.

## Re-running this

```powershell
powershell -File scripts/build/sample-build-memory.ps1 -OutFile peak.json
# in another shell:
cargo clean -p personas-desktop --manifest-path src-tauri/Cargo.toml
cargo build --features desktop --lib --manifest-path src-tauri/Cargo.toml
# then:
echo "" > build-memory.stop     # sampler writes peak.json and exits
```

`peak_rustc_cmdline` in the output attributes the peak to a crate — without it
you know the number but not which compilation unit produced it.
