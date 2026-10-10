# Claude Code mods for this checkout

Function-hook plugins (early-access API, Claude Code 2.1.292+). One mod per concern, so a misbehaving one is disabled alone.

| Mod | What it does | Fails |
|---|---|---|
| `dev-law` | Denies shell commands this machine already paid for (sweeping `git add`, `git stash` and branch switches in a shared checkout, bare `cargo test`, unscoped vitest, blind node kills, MSYS traps). Adds the doc-sync reminder: after an Edit/Write on source owned by `scripts/docs/feature-doc-map.json`, the Edit result tells the model its feature doc is stale, once per doc. Adopted from the user-level `fleet-guard`. | open (the `permissions.deny` list is the hard floor) |
| `result-economy` | Keeps the head (80) and tail (120) of tool results over 300 lines or 30k chars, with a visible `[result-economy: N of M lines omitted ...]` marker, and redacts distinctive secret tokens. Never touches Read/Edit/Write results. | open (the model gets the original) |
| `athena-skin` | Athena's words on the spinner and turn line, a band above the prompt with a turning orb, her blue as the one accent. Terminal only; fonts are not reachable from a mod. | open |

## Load them

```bash
claude --plugin-dir .claude/mods/dev-law --plugin-dir .claude/mods/result-economy --plugin-dir .claude/mods/athena-skin
```

or list them in `CLAUDE_CODE_PLUGIN_DIRS` (path-list separator `;` on Windows). They are NOT wired into the tracked
`.claude/settings.json`, deliberately: that would also load them into every fleet and appmaster worker, and `dev-law`'s
reminder would change what unattended builders see. Load them per session, or in your own `settings.local.json`.

If the user-level `fleet-guard` is also loaded, both deny the same commands; drop `fleet-guard` from your plugin dirs.

## Headless workers (measured 2026-10-07, claude 2.1.292)

- `claude -p --plugin-dir <mod>` LOADS mods and enforces them.
- `claude -p --bare` REFUSES them (`installed plugins that are not managed load no hooks module in this mode`).
  Workers spawned with `--bare` stay on `.claude/settings.json` `permissions.deny`.

## Authoring traps found while building these

- Tool-call events are flat: `e.command`, `e.file_path`, not `e.input.*`.
- `$` may only be passed to a function declared at the top of the file, never to an inner closure.
- The engine's Windows cwd has backslashes (`C:\Users\...`); a `[\/]` class only matches `/`. Test with a backslash cwd.
- Of three ways to reach the model, only a rewritten tool result (`session.append`, door `tool-result`) was observed to arrive.
  A `$.session.append` row at turn end and a `prompt.compose` section did not.
- `claude plugin test <mod>` and `claude plugin validate <mod>` before trusting any of it.
