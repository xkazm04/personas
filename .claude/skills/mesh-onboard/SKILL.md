---
name: mesh-onboard
category: Infrastructure
memory: none
description: Pair this desktop's Personas app with another desktop's Personas app on the same LAN and prove the device mesh together - preflight diagnostics, discovery, one 6-digit pairing code typed by the operator, then a mutual test suite (ping, snapshot, agent toggle, queue move, optional fleet push, session kill, CLI mail echo) run by BOTH machines' Claude Code sessions, which coordinate through the apps' own /mesh door so the operator never relays a message between them. Run it on each desktop. Invoke with `/mesh-onboard` or `/mesh-onboard --allow-push`.
argument-hint: "[--allow-push]"
allowed-tools: Bash, Read, AskUserQuestion
version: 1.0
---

# /mesh-onboard - pair two Personas desktops and prove the mesh

Two machines, two Claude Code sessions, one skill each. Each session drives ONLY its own
Personas app, through the app's token-gated `/mesh` HTTP door on 127.0.0.1. The apps discover
each other on the LAN, pair, and carry a CLI mailbox between them; the two sessions coordinate
over that mailbox. **The operator never carries text from one machine to the other.** If the
apps cannot see each other, this skill stops and prints the exact fix. There is no git fallback
and no "paste this over there": the operator chose apps-only.

> **What you will be asked (operator)**
>
> 1. Run `/mesh-onboard` on BOTH desktops (any order). Add `--allow-push` on a desktop that
>    should also run the push test (it commits one file on a throwaway branch
>    `remote/<id>/<id>` on the other desktop, verifies the push, then deletes that branch).
> 2. On ONE desktop (the responder) you get a single question: type the 6-digit code that the
>    OTHER desktop shows in large text. Once. A typo can be retyped while the code is valid.
> 3. Only if a diagnostic is red: run the one fix command it prints (firewall commands need an
>    Administrator terminal), then run `/mesh-onboard` again. It resumes where it stopped.
> 4. Only if more than one Personas desktop is visible on the network: pick which one.
>
> Nothing else. Everything between the two sessions travels through the apps.

## Prerequisites (check them, and explain any that fail in plain words)

- **The Personas app is running on this machine**, built with P2P. The daily (lite) build
  carries P2P since the device-mesh change; an older build does not. `preflight` proves both.
- **Both desktops are on the same LAN** (same router or Wi-Fi). The mesh does not cross the
  internet. On Windows the active network profile must be **Private**; Public blocks discovery.
- **The repo on BOTH machines is at a commit that contains this skill** (`.claude/skills/mesh-onboard/`
  and `scripts/mesh/`). If the other desktop lacks it, the operator updates that checkout
  first; you cannot do it for them.
- Run every command below from the repository root (the directory holding `package.json`).
  Call `node scripts/mesh/onboard.mjs ...` directly, NOT through `npm run`: npm prints its own
  banner on stdout, and the contract below is one JSON line on stdout.

## Hard rules

- **Never print, log or echo the local token** (it lives in the app's handshake file; the
  script reads it and never returns it). Do not `cat` the handshake file.
- **Never write the app's database.** Every write goes through the app's `/mesh` door.
- **Never `git stash`, `git reset` or `git add -A`.** The only git commands this skill runs are
  t5's `git push origin --delete remote/...` and `git ls-remote`, inside the script, and only
  with `--allow-push`.
- **Never relay.** Do not ask the operator to copy anything from the other machine except the
  pairing code, which is the one human check the pairing is built on.
- **On a failure, print the exact `fix` from the JSON and stop.** Do not improvise workarounds.

## The script contract

`node scripts/mesh/onboard.mjs <subcommand> [flags]` prints exactly ONE JSON line on stdout.
Progress lines go to stderr. Read the JSON; show the operator one short status line per step.

| Exit | Meaning | What you do |
|---|---|---|
| 0 | ok | continue |
| 1 | failed or blocked | show `detail` and `fix` (and each `failing[].fix`), stop |
| 2 | usage | you called it wrong; fix the call |
| 3 | the typed code is wrong or malformed | ask the operator to retype (see Phase 3) |
| 4 | a wait timed out | show `detail` and `fix`, stop; a re-run resumes |
| 5 | several devices visible | ask the operator which one (Phase 2) |

State is persisted per peer in the app's data directory (`~/.personas/mesh/onboard-<peer8>.json`,
or under `PERSONAS_DATA_DIR` when that is set), so a killed session resumes at its step.

## Phase 0 - Resume

Run `node scripts/mesh/onboard.mjs status`. If `resume` names a peer, say "Resuming onboarding
with <displayName>" and continue at its `nextStep` with `--peer <peerId>`:
`discovered` -> Phase 1, `paired` -> Phase 3, `tested` -> Phase 4, `reported` -> Phase 5.
For the role, run `status --peer <peerId>` and read `state.role`.
If `resume` is null (or every state is finished and the operator wants a fresh run), start at
Phase 1. Still run Phase 1 on a resume: the app may have restarted since.

## Phase 1 - Preflight

`node scripts/mesh/onboard.mjs preflight`

- Exit 0: say "Preflight green (app <appVersion>)". `warnings` are not blockers: a
  `mdns_sees_peers` warning only means the other desktop is not visible YET, which is normal
  when this machine is first. Mention it in one line.
- Exit 1 with `failing`: list each failing check as `<id>: <detail>` and its `fix` verbatim in
  a code block. Firewall fixes (`netsh advfirewall ...`) need an Administrator terminal; say so.
  Then stop and tell the operator to run `/mesh-onboard` again after the fix.
- Exit 1 with `error` (`app_not_running`, `unauthorized`, `not_found`, `p2p_unavailable`):
  show `fix` and stop.

## Phase 2 - Discover

`node scripts/mesh/onboard.mjs discover --timeout 540` with the Bash tool timeout at 600000 ms.
It polls the app's discovery list inside the script (no turns burned) until the other desktop
appears.

- Exit 0: remember `peerId` and `role`. Say "Found <displayName>; this machine is the <role>."
- Exit 5: one AskUserQuestion, "Which desktop should this machine pair with?", one option per
  `candidates[]` entry (label = displayName, description = the first 8 characters of its
  peerId). Then re-run `discover --timeout 540 --peer <chosen peerId>`.
- Exit 4: show `detail`, every `failing[]` entry with its fix, and `fix`. Remind the operator
  that the other desktop must be running `/mesh-onboard` too. Stop.
- **Multicast-blocked LANs (the operator's router drops mDNS).** When every preflight check is
  green on both machines and discovery still times out, the fallback is an explicit LAN
  address: each session runs `discover --timeout 540 --address <other-ip>:<its quicPort>` (the
  other machine's preflight prints its `quicPort`; the operator reads its IP from Settings or
  `ipconfig`, typed once per machine). Only local-network addresses are accepted (10.x, 172.16-31.x,
  192.168.x, link-local, loopback); anything else is refused by the app. The link is authenticated
  by its handshake, not trusted: pairing still needs the typed code.

## Phase 3 - Pair (one human code)

If `discover` said `paired: true`, skip to Phase 4.

**Initiator** (role `initiator`; the lower peerId):
1. `node scripts/mesh/onboard.mjs pair --peer <peerId>` -> `{code}`.
2. Show the code LARGE, alone, for the operator to read off this screen:

   ```
   ==================================
        PAIRING CODE:   042-917
   ==================================
   Type this code on the other desktop when it asks.
   ```
3. `node scripts/mesh/onboard.mjs pair --peer <peerId> --wait --timeout 540` (Bash timeout
   600000 ms). Exit 0 -> "Paired." Exit 4 -> the code expired unconfirmed: run step 1 once more
   (a new code), show it, and wait again; if that also times out, stop with its `fix`.

**Responder** (role `responder`):
1. `node scripts/mesh/onboard.mjs pair --peer <peerId> --timeout 540` (Bash timeout 600000 ms)
   waits for the initiator's request -> `{awaitingCode: true}` (or `{paired: true}`: skip ahead).
2. Ask ONE question with AskUserQuestion:
   - question: "Type the 6-digit pairing code shown on the other desktop (<displayName>)."
   - header: "Pair code"
   - options: `I'll type it` (description: "Choose 'Other' and type the code, e.g. 042-917")
     and `Cancel` (description: "Stop onboarding; nothing is paired").
   The operator types the code into the free-text "Other" answer. If they pick `I'll type it`
   without a code, ask the same question again. On `Cancel`, stop.
3. `node scripts/mesh/onboard.mjs pair --peer <peerId> --confirm <what they typed>`.
   - Exit 0: "Paired."
   - Exit 3: "That code does not match (<secondsLeft> s left). Please retype it." and ask again
     (step 2). Keep going while `secondsLeft` > 0.
   - Exit 1 `no_pending_pairing`: the request expired; show `fix` and stop.

## Phase 4 - Mutual tests

Both sessions run this at the same time; the script waits for the other one (a hello
handshake over the app mailbox) and then runs each test in lockstep.

Run `node scripts/mesh/onboard.mjs test --peer <peerId>` (append `--allow-push` only if the
operator invoked `/mesh-onboard --allow-push`) with **`run_in_background: true`**: the suite
can take longer than one foreground Bash call allows (a headless session runs on the other
desktop during t4). Tell the operator "Running the mutual tests with <displayName>..." and
wait for the background command to finish; do not poll it in a loop. If this session is
interrupted, re-running the same command resumes at the step it reached.

| Test | What it proves |
|---|---|
| t1_ping | the other app answers a real `ping` job with its version |
| t2_snapshot | the other app's live snapshot arrives here, fresh (<= 45 s) |
| t3_toggle | a DISABLED agent on the other desktop is switched on and back off; skipped if it has none (an enabled agent is never touched) |
| t4_queue_move | a harmless held queue entry moves to the other desktop and runs there |
| t5_fleet_push | with `--allow-push` only: a one-file commit is pushed from the other desktop, verified, and its branch deleted |
| t6_kill_wake | an interactive session on the other desktop is killed on command (wake is reported as not exercisable) |
| t7_cli_mail | a nonce round-trips between the two sessions |

The JSON lists every test with `result` (passed only when BOTH sides passed), `thisSide` and
`peerSide`. Show one line per test: `t1_ping  passed` or `t3_toggle  skipped - <detail>` or
`t4_queue_move  FAILED at <stalledAt> - <detail>`. A failed test is a finding, not a reason to
retry blindly; `aborted.step: "hello"` means the other session never joined: tell the operator
to run `/mesh-onboard` there.

## Phase 5 - Report

`node scripts/mesh/onboard.mjs report --peer <peerId>` -> `{path}`. Tell the operator the
report path and the totals line. Both desktops write their own report; each records its own
verdicts in its app (the Monitor's device plate shows the last one).

## One-box development (two app instances on one machine)

Start each app instance with its own `PERSONAS_DATA_DIR`. Run each CLI with the same
`PERSONAS_DATA_DIR` as its app: the script then reads `<PERSONAS_DATA_DIR>/local-http.json`
and keeps its state under `<PERSONAS_DATA_DIR>/mesh/`. `PERSONAS_HANDSHAKE=<file>` overrides the
handshake path outright. The stub-door tests run the same flow in memory:
`node --test "scripts/mesh/**/*.test.mjs"`.
