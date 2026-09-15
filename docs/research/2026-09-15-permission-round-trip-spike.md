# Spike: can the `-p` child send a permission decision to an MCP tool?

Date 2026-09-15. Direction `.ai/directions/2026-09-15-qwenpaw-comparison.md`, ranked feature 3, test T4 (§3.1, §3.2, §3.5, §4.2). Registry technique: `agent-cli-transport/host-routed-approval-round-trip`. No production code changed.

## Question

Every `-p` spawn passes `--dangerously-skip-permissions` (`src-tauri/engine/src/prompt/cli_args.rs:107`). Stdin carries plain text, so control requests cannot travel over it (`provider/claude.rs:106-107`). The personas-mcp sidecar is the only two-way channel already inside the child. Can print mode hand a permission prompt to a tool on that server, and does a deny answer actually stop the call?

## Recorded evidence

The full help text for `claude` 2.1.272 is in `docs/research/2026-09-15-claude-cli-help.md`. These are the lines that decide the question, quoted exactly:

```text
  --permission-prompts <target>         Who answers permission prompts with
                                        --print: "host" (the SDK host or
                                        --permission-prompt-tool) or "none"
                                        (nobody: anything that would prompt is
                                        denied automatically; the permission
                                        mode still decides everything else)
                                        (choices: "host", "none", default:
                                        "host")
```

```text
  --permission-mode <mode>              Permission mode to use for the session
                                        (choices: "acceptEdits", "auto",
                                        "bypassPermissions", "manual",
                                        "dontAsk", "plan")
```

The help documents that, in print mode, a `--permission-prompt-tool` answers permission prompts by default. One caveat: `--permission-prompt-tool` has no entry of its own in the options list. It is named only inside the `--permission-prompts` description. So the text alone does not give the flag's argument syntax, and T4 is the evidence that the CLI accepts it.

## T4

Setup: a throwaway directory `C:/t/w-personas-perm-spike-t4/` outside the repo. It held `deny-server.mjs`, a stdio MCP server named `permstub` with one tool, `deny_permission`. The tool logs every call and always returns `{"behavior":"deny","message":"denied by permstub (T4 arm B)"}` as text. It also held `mcp.json`, which points at that server. Both arms read the same prompt from stdin, the same way personas does (`-p -`):

> Use the Bash tool to run exactly this one command and nothing else: echo spike > C:/t/w-personas-perm-spike-t4/marker.txt . Then reply DONE or DENIED.

Both commands ran from the T4 directory. `--setting-sources local` keeps user-level allow rules and hooks out of the result.

Arm A (what personas does today):

```text
claude -p - --model haiku --output-format stream-json --verbose --max-budget-usd 0.25 --no-session-persistence --setting-sources local --strict-mcp-config --mcp-config C:/t/w-personas-perm-spike-t4/mcp.json --dangerously-skip-permissions
```

Arm B (delegation, no skip flag):

```text
claude -p - --model haiku --output-format stream-json --verbose --max-budget-usd 0.25 --no-session-persistence --setting-sources local --strict-mcp-config --mcp-config C:/t/w-personas-perm-spike-t4/mcp.json --permission-prompt-tool mcp__permstub__deny_permission
```

The marker was deleted between the two arms.

| | Arm A | Arm B |
|---|---|---|
| init `permissionMode` | `bypassPermissions` | `default` |
| Bash `tool_use` emitted | 1 | 1 |
| Bash calls executed | **1** (marker created, contents `spike`) | **0** (no marker) |
| `tool_result` | `is_error:false`, "(Bash completed with no output)" | `is_error:true`, "denied by permstub (T4 arm B)" |
| Requests in the permission-tool log | 0 | **1** |
| `result.permission_denials` | `[]` | 1 entry, Bash, same `tool_use_id` |
| final text / turns / cost | DONE / 2 / $0.022 | DENIED / 2 / $0.022 |
| model | claude-haiku-4-5-20251001 | same |

The arm B tool log recorded the request:

```json
{"event":"permission-request","params":{"name":"deny_permission","arguments":{"tool_name":"Bash","input":{"command":"echo spike > C:/t/w-personas-perm-spike-t4/marker.txt","description":"Create marker file with content \"spike\""},"tool_use_id":"toolu_01FsP96WzRiEmi9Wt4w4idhP"},"_meta":{"claudecode/toolUseId":"toolu_01FsP96WzRiEmi9Wt4w4idhP","progressToken":2}}}
```

Measurable: arm B executed 0 Bash calls (target 0). Arm A executed 1. The request reached the tool with the literal command and its `tool_use_id`, and that is the disclosure a consent gate needs. The deny was enforced: the call did not run, the model saw the denial message, and the CLI listed the call in `permission_denials`.

The tool name format (`mcp__<server>__<tool>`) and the reply shape (`behavior`/`message`) come from outside the recorded help. The observed behavior is what confirms them.

## Verdict

**Proceed to the second context.** The `-p` child can send a permission decision to a tool on a host-supplied MCP server, over the same text-stdin, stream-json-stdout lane personas already uses. No server mode or stdin control channel is needed, which matches §4.2's constraint.

## What a build needs

- **Tool.** Add `permission_request` to the personas-mcp tool list (`src-tauri/src/mcp_server/tools.rs`). Pass it as `--permission-prompt-tool mcp__personas__permission_request`, using the sidecar's real server name from `cli_mcp_config.rs`. It creates a `manual_reviews` row from the request's `tool_name`, `input` and `tool_use_id`, never from a summary the model writes. Then it waits on that row.
- **Deny by default (§3.2).** A timeout, an unknown request shape, an unresolvable session, an internal error, or an unreachable DB all answer `deny`. Only an explicit approval answers `allow`. The waiting window starts from `unattended.rs:370-385`, and it must end before the CLI's own request timeout. If the CLI times out first, a late approval lands on nothing.
- **Not measured here, owed to the build:** what the CLI does when the permission tool crashes, hangs or returns malformed output. Test this before shipping, not assume it. If the CLI fails open in any of these cases, the wire is not a boundary. `--permission-prompts none` is the documented fallback: it auto-denies.
- **Grant scope.** An approval covers that one `tool_use_id` in that one turn. It is never a standing or session-wide grant, and never inherits autonomous mode's consent (§3.3).
- **Binding.** The review row records the originating execution and session. The resolver refuses a decision from outside that session unless an administrator is named in the record.
- **Per-persona stance (§3.5).** A persona column, off by default, is included in `compute_config_hash` (`session_pool.rs:133-146`), so a warm or resumed session never carries the other stance. `cli_args.rs:98-108` drops `--dangerously-skip-permissions` and adds the delegation flag only when the stance is on. Resume (`:327`) needs the same conditional.
- **Not for unattended runs.** A persona with nobody watching keeps the skip flag or a stance set before the run. The round trip only turns every prompt into a timed-out deny.
