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

## Taste

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

## Skill improvement log
