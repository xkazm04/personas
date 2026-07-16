---
id: test-a-tool
title: Hand-test a persona's tool before trusting it in production
promotion: discovery
primary_contexts: [agent-use-cases, tool-runner, agent-editor]
surfaces: [personas]
relevant_characters: [software-developer, hobbyist-power, it-sysadmin]
---

## Goal (user POV)
"Before I let a persona's tool run unattended inside a real execution, I want to fire it once myself, with real inputs, and see exactly what comes back — success, or a diagnosable failure, not a shrug."

## Definition of done
- I found the tool runner from the Use Cases tab without hunting, ran a tool with real inputs, and got a legible result.
- When it failed, the error told me *what kind* of failure (auth / timeout / rate-limited / misconfigured / transport) — not an opaque string I have to guess at.
- I trust the sandbox: a script-backed tool can't reach outside its allowed roots.

## What L1 must check
- Reach path: Persona → Use Cases tab → Run tool → the `ToolRunnerPanel` — is it discoverable, and does it require leaving the persona context?
- The result contract: does a failure surface a typed `ToolErrorKind` (auth/timeout/http/transport/misconfigured/rate_limited) with `http_status`/`retryable`/`output_truncated` where relevant, or does everything collapse into one generic error string?
- Script-path sandboxing: is a script-backed tool's `script_path` actually validated against allowed roots before spawn, and is that validation visible/legible (not just a silent 500)?

## What L2 must confirm (l2_priority)
- Running a real tool with real inputs (not a stub) returns output that matches what a full execution would have produced — the manual test is trustworthy, not theater.
- A deliberately-broken input (bad auth, wrong path, unreachable host) produces the *correct* typed error kind live, and the message is something a Character could act on without reading source.
- Output truncation (`output_truncated`) is flagged to the user rather than silently clipping a long result.
