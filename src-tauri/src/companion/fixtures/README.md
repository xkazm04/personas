# Companion stream fixtures

Captured wire bytes for the companion's stream-json parsers, included by the
unit tests with `include_str!`. Every file here is a line a real process
emitted, never one written by hand: an invented fixture can only encode the
author's belief about the wire, which is the belief under test
(`docs/concepts/golden-paths/model-output-streaming.md`).

| File | What it is |
| --- | --- |
| `grok-result-line.ndjson` | One `result` line from grok CLI 1.0.34 (`--output-format streaming-messages-json`), captured 2026-09-17 on the operator's machine during the hybrid-LLM-engine spark. Same envelope as the Claude CLI's `result`; `turn_ledger.rs` pins that the unchanged parser reads it. |

Files stay valid NDJSON (one JSON object per line, no comments), so the
provenance lives in this table rather than in a header.
