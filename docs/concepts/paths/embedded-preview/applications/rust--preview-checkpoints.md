---
layer: application
subject: embedded-preview
technique: preview-checkpoints
stack: rust
---

# `versions.rs` in the preview loop — turn snapshots over a live guest

The checkpoint *mechanics* of `src-tauri/src/webbuild/versions.rs` are
already documented as undo-history's canonical application
(`docs/concepts/paths/undo-history/applications/rust--checkpoint-restore.md`),
and its swallowed-capture-failure and no-pre-restore-capture findings are
registered at `#w7-undo-history` in `golden-path-deferred-fixes.md`. This
application does not re-derive those; it reads the same code through the
preview-specific lens this technique owns: turn alignment, and what
restore does to the *running* preview.

## Capture is aligned to the turn — exactly

`commit_snapshot(project_path, &reply)` is called from
`run_build_turn` (`companion/session.rs:2084-2086`) immediately after
the turn's text is parsed and before `BuildTurnResult` returns — one
snapshot per completed mutation turn, never mid-turn, never on a timer.
The label is minted from the turn's own reply (`versions.rs:24-25`,
`"athena: <first line, ≤72 chars>"`), so `StudioVersions` lists a
*conversation* timeline, which is the identity the technique asks for.
The store is the project's own git repo, present because the scaffold
ran `git init` (`:3-4`) — the "checkpoint substrate for free" case.

## Restore reaches two of the three parties

`webbuild_restore_version` → `restore()` (`:67-84`) does the tree
(`git checkout <sha> -- .`, forward, non-destructive). The frontend then
calls `onRestored` = `reloadActive` (`StudioVersions.tsx:32-34`,
`StudioPage.tsx:297`, `:200-201`), which bumps the tab's iframe nonce:
the frame remounts (`key={\`${id}-${nonce}\`}`, `:234`) and the route
list rescans (nonce is a dependency of the discovery effect,
`:101-112`). So:

| party | done? | how |
|---|---|---|
| tree | yes | `git checkout sha -- .` |
| server | left running (correct default) | Next watches the tree; hot-reload repaints |
| frame | yes | nonce remount = full reload; agent handshake (such as it is) reruns |
| discovered routes | yes | rescan on nonce |
| bridge pending state | n/a | the host holds no pending table (see the protocol application) — nothing to drain, which is a different defect |

## Deviations (reported, standard kept)

- **Boot-only files are not distinguished.** A restore that reverts
  `package.json` or `next.config.*` leaves the running server on the old
  dependency graph/config; the technique's "know which restores need a
  server restart" is unimplemented — nothing inspects the diff between
  the current tree and the target sha for those paths. Cheap to add: a
  `git diff --name-only <sha>` filter on a small manifest list before
  `checkout`, and a `start()` when it hits.
- **Capture failure is silent, at the moment of the loop that most
  needs it.** Registered at `#w7-undo-history` (both git commands in
  `commit_snapshot` discard results, `:26-33`); the preview-specific
  consequence is that `BuildTurnResult` carries no "snapshot: ok/failed"
  field, so the store cannot show a turn as unprotected. Cited, not
  re-registered.
- **No pre-restore capture.** Also `#w7-undo-history`; in the preview
  loop the invariant "every turn ends committed" holds *unless* the user
  edited the project directly between turns (a register-existing repo
  invites exactly that), in which case `checkout -- .` erases their
  edits without a trace. Cited, not re-registered.
