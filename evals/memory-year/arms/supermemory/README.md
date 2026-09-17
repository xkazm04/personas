# The supermemory arm - run kit

The adapter is `memory_year/backends/supermemory.py`; its docstring states the claim under
test, what a win and a loss look like, and the design choices the report must carry. This
directory holds what it takes to drive the real engine from the harness.

| file | what it does |
| --- | --- |
| `claude_shim.py` | OpenAI-compatible `/v1/chat/completions` over the harness's cached Claude CLI. The engine's write-time model is a tool-calling agent; the shim renders the tools and transcript into one CLI call and returns the tool calls as JSON, batched per turn. Counts calls and tokens into a stats file the adapter reads as write cost. |
| `run_arm.py` | Starts the shim and the server, runs one harness rung, tears both down. Writes `done-<tag>.flag` on a completed run. |
| `supervise.py` | Runs `run_arm.py` across model-budget windows: after a budget stop it sleeps until the reset time the CLI reported, then resumes. |

## Setup

```sh
# the Windows x64 server binary from the engine's GitHub release (server-v0.0.8, sha256 d8fb2ac0...)
gh release download server-v0.0.8 -R supermemoryai/supermemory -p 'supermemory-server-windows-x64.exe*' -D "$SM_ARM_ROOT"
py evals/memory-year/arms/supermemory/supervise.py year --windows 6
```

`SM_ARM_ROOT` (default `C:\t\sm-arm`) holds the binary, the store, the logs and the recorded
contexts. Keep it short and outside the repo; a store is a few hundred megabytes.

## Why a year takes several windows

One document per simulated day, each processed by an extraction agent that makes about three
CLI calls, is roughly a thousand write-time calls for the year - more than one subscription
window. The adapter makes that safe rather than merely possible:

- the checkpoint records each document's id **before** its processing wait, so a run killed
  mid-document deletes and re-sends it instead of duplicating it;
- a document whose extraction failed is deleted and re-sent in day order on resume, because a
  day stored as chunks with no memories is a hole in the design under test;
- three consecutive failed documents stop the run (that is the budget, not the design);
- every probe's context is recorded at its own instant and **replayed** on resume, because the
  store has grown since and a live search would answer an early probe with the rest of the year.
  Replayed contexts are identical strings, so the consumer and judge calls come from cache.

## Known hazards of the engine under this harness

- It stamps and expires memories on its **wall clock**. The scenario is dated 2025; any expiry
  the extraction agent writes has already passed when it is written, and the profile endpoint
  labels every entry with the real date. Recorded in the run header as `clock_hazard`.
- Ingestion order within a container is the engine's temporal authority, so documents are sent
  strictly in order and each is waited on to `status=done` and `dreamingStatus=done`.
- The server's own default search cap (`limit` 10, `threshold` 0.5) would outrank the harness
  budget; the arm searches with `limit` 100 and `threshold` 0 so the budget binds.
