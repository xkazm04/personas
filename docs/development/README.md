# Development

Use these docs for day-to-day engineering work.

| Document | Scope |
| --- | --- |
| [development.md](development.md) | Local dev loop, repository shape, debugging |
| [build.md](build.md) | Web and desktop build flow |
| [build-cache.md](build-cache.md) | Capping `target/` + agent-worktree disk use |
| [android-build.md](android-build.md) | Android build notes |
| [test-automation.md](test-automation.md) | Test automation harness |
| [devlog.md](devlog.md) | Structured dev-server logs, toolchain capture and the `npm run devlog` digest |
| [adoption-test-framework.md](adoption-test-framework.md) | Template adoption test framework |
| [headless-bridge.md](headless-bridge.md) | Driving the running app from a terminal: register projects, scan, adopt an App Master, write worker results back (moved from the root README) |
| [ipc-orphans.md](ipc-orphans.md) | Census of registered IPC commands with no caller, classified with per-command dispositions (report only — nothing deleted) |

Primary commands are defined in `package.json`. The most common checks are `npm run check`, `npm run test`, and `npm run build`.

