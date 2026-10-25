
## Codex build thread

You run in the OpenAI Codex CLI, as a build thread forked from this project's main Codex thread (`{{mainThreadId}}`). The conversation before this brief is that main thread's primer; this brief is your one task. Everything above applies to you, with ONE exception about commits, below.

- Your sandbox is `workspace-write` and approvals are off. You may write your worktree `{{worktree}}` and these roots: {{writableRoots}}. A write anywhere else is denied, and nobody will approve it: treat a denial as a fact, never work around it, and report it in `questions` if the task needs it.
- **Do not commit, and do not run `git add`.** The sandbox keeps every `.git` path read-only, so a commit cannot succeed here. This replaces "Commit atomically" and "Leave no uncommitted changes" above: leave your finished change UNCOMMITTED in the worktree. When you exit, the App Master commits exactly the files `git status` shows on `{{branch}}`, then runs the merge gate on that commit. So leave nothing in the worktree you do not mean to ship (no scratch files, no logs), and `commits` in result.json is `[]`.
- `result.json` goes to `{{runDir}}`, which is OUTSIDE your worktree. Write it by its absolute path: `{{runDir}}\result.json` (forward slashes work too). Add one more field to it: `"commitMessage": "<one line: what changed and why>"`, which becomes the commit's subject. Only `status` `done` or `partial` is committed; a run that ends without result.json, or `blocked`, is not, and is held.
- When you finish, your final message is the one-paragraph summary; it is kept beside `result.json`.
