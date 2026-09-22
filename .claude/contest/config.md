---
vault: ["C:/Users/kazda/kiro/personas/.contest"]
vault_subdir: Contest
arena: .contest/arena
participants: "claude:opus@xhigh,grok:grok-4.6@high"
judges: "codex:gpt-5.6-sol@high,grok:grok-4.6@high"
variants: 3
timeout_min: 60
---

# Contest overlay - Personas Desktop

## Engines

All three CLIs resolve from PATH on this machine:

- `claude` -> `C:/Users/kazda/.local/bin/claude.exe`
- `grok` -> `C:/Users/kazda/.grok/bin/grok.exe`
- `codex` -> `C:/nvm4w/nodejs/codex` (npm shim; the runner resolves it to its entry script)

No `CONTEST_*_BIN` override is needed. Codex's own default model is `gpt-5.6-sol` at `high`.

## Data

This repo's material for a UI brief comes from the LIVE app, not from fixtures:

- persona documents: `~/.personas/personas/<uuid>/manifest.md` (22 of them today)
- the rows behind them: `%APPDATA%/com.personas.desktop/personas.db`, tables `personas` and
  `persona_memory_review_proposal` (copy the db before reading it - the app holds it open)
- design tokens: `src/styles/globals.css` `:root` and `src/styles/typography.css` `.typo-*`

**Never stage `~/.personas/companion-brain/constitution.md`.** It is the operator's own
companion brain and is personal; cite its SIZE as the scale evidence and stage nothing from it.

## Taste - UI contests

Judge these harder than the rubric alone would, in this repo:

- **Reading size.** `.typo-caption` is body-sized (0.875rem) here on purpose. A prototype whose
  prose drops to 11px to buy density has failed, whatever else it did.
- **Keyboard over chrome.** This operator works from the keyboard. A toolbar of glyph buttons
  hovering over text is a downgrade; a shortcut nobody can discover is not a feature.
- **No em dash in app text** is a standing repo rule for shipped strings (memory:
  `feedback_no_em_dash_in_app_text`). Prototypes are not held to it, the promotion is.
- **A spinner is never a surface loading state** in this app; a control the user pressed always
  gets a real one. See `.claude/CLAUDE.md` "The spinner boundary".
- **Levels, not one layer**, and heavy content gets its own surface - the two patterns the
  owner's first contest review (tracklight, 2026-09-18) bought with a rejected panel favourite.

## Taste - design contests (vault subdir `Backend`)

A **design contest** runs the same instrument on a backend architecture brief: a variant is a
design report that opens in a browser, not a UI prototype, and it lands in the `Backend` vault
subdir so the UI pattern ledger is not quoted at an architecture seat. Pass
`--vault-subdir Backend` on `init`.

Material is staged by the host into `.contest/staging/<id>/`. **Never stage row content from the
live database.** `%APPDATA%/com.personas.desktop/personas.db` is 214 MB of this person's real
work; read a COPY, stage table names and row counts only, and say in `SCHEMA.md` where a
designer would need content to be sure of something. The same rule as the companion brain.

The seven dimensions are read against a report: **wow** is the idea not the gradient, **clarity
at scale** is an argument that survives the real system's complexity, **wayfinding** is report
navigation, **interaction** earns its place only when it shows what static cannot, **craft**
includes a wrong signature or an invented table, **concept** is a falsifiable architectural bet,
and **utility** decides it - could the owner build from this tomorrow with the risks on the
table. Judged harder: honesty about unknowns, an incremental migration path against the live
214 MB database, failure modes named, `file:line` citation of the tree, diagrams that carry
mechanism, and body text at 15 px or more.

**Codex on Windows needs the bypass flag.** Re-probed 2026-09-22: `--sandbox workspace-write`
still answers "the read-only filesystem policy blocked the write"; the runner now passes
`--dangerously-bypass-approvals-and-sandbox` and the write succeeds. This closes the PROPOSAL
recorded under 2026-09-21 below.

**Grok Build balance is still exhausted** (402 Payment Required, the seat errors in ~6 s on
2026-09-22). Probe the seat before counting on it.

## Skill improvement log

- 2026-09-21 (kpi-descent) - **A brief that ASSIGNS the three variants fights the rendered
  participant brief, which says the opposite.** `references/participant-brief.md` hard-codes
  "each a genuinely different answer to the idea - a different metaphor", and this contest
  needed variant-1/2/3 fixed to Map/Ledger/River. The host patched the paragraph in all three
  rendered `PARTICIPANT.md` files by hand and md5'd them to prove they stayed identical. The
  same template hard-codes a previous contest's filename in its data line
  (`<script src="../data/knowledge.js">`). PROPOSAL for the registry (not applied - the
  ai-registry checkout has a sibling's uncommitted edits on these exact files): template the
  deliverable paragraph, and derive the data example from the staged directory.
- 2026-09-21 (kpi-descent) - **A judge can report `completed` and produce no verdict.** The
  codex seat exited 0 in 141s with an empty final message: on Windows its shell was
  "rejected by policy" and its write was "blocked by read-only sandbox" despite
  `--sandbox workspace-write` (see `runs/judge-*/stderr.log`). `aggregate` then built a
  scoreboard from the host's verdict alone and called it a panel. Re-running the seat by hand
  with `--dangerously-bypass-approvals-and-sandbox` produced a full verdict in ~8 min.
  PROPOSAL: treat a completed judge that wrote no verdict as a failed judge, and say out loud
  when the scoreboard has fewer than two panel verdicts.
- 2026-09-21 (kpi-descent) - **The per-seat wall-clock ceiling did not fire for the grok
  judge:** the record reads `timed-out in 11101.38s` against a 45-minute (2700 s) ceiling, so
  it held the step for three hours. Grok's weekly balance was exhausted by the retry
  (402 Payment Required), which cost the panel its second judge - budget grok's quota for the
  judging pass, not only for the building pass.
- 2026-09-21 (kpi-descent) - **Stage the data with its honesty rule, or the winners will
  break it.** `data/SCHEMA.md` documented the `series` shape but never said which rows count
  as an observation, and all three winning variants counted 39 `source: "simulation"` rows
  across 37 KPIs as real readings - 25 of those KPIs are `unmeasured` in the live rollup. The
  app's own `realPoints` already filters `env === "production"` plus a not-directly-measured
  source set. Any future UI brief here must copy that filter into SCHEMA.md; the blind judge
  caught it by reading code, and the visual pass could not have.
- 2026-09-21 (kpi-descent) - **The two-eyes design worked exactly as intended and the
  disagreement was the finding.** The code-reading judge and the pixel-reading host agreed
  within 0.5 on seven of nine variants and differed by 3.4 and 3.6 on the other two: both
  were logically sound surfaces that leave 40-70% of the window empty on the real data. A
  panel of readers alone would have ranked them fourth and fifth.
