# `uat/` — Character-driven UAT overlay (Personas)

This is the **per-run overlay** for the `/uat` skill (`.claude/skills/uat/skill.md`). The skill is the app-agnostic-ish engine; this folder holds the variable cast: who the Characters are, which journeys, the rubric, the env/fixtures, and the run artifacts.

> **What this is NOT:** the `tools/test-mcp/e2e_*.py` suite (that's *verification* — "does the code work"). This is *evaluation* — "can this kind of person finish their job, and is it good enough to adopt?" It reuses the same harness (`tools/test-mcp/lib/`) at L2.

## Layout

```
uat/
  README.md            # this file (+ Character template below)
  characters/*.md      # 15 durable users (thorough roster)
  journeys/*.md        # goals (NOT scripts) + user-POV definition-of-done
  rubric.md            # 7-dimension lens + severity + cognitive-walkthrough questions
  env.md               # L2 run recipe + fixtures (THE per-app file)
  accepted-gaps.md     # baseline of known/accepted issues
  driver/drive.py      # thin L2 driver over tools/test-mcp/lib/ (navigate/snapshot/click/fill)
  driver/drive_ai.py   # AI-surface driver (fill → wait-for-settle → capture → judge grounding)
  runs/<date-slug>/    # findings.json, report.md, SUMMARY.md, per-character journals (+ gitignored captures/)
```

## How to run

```
/uat init            # scaffold (already done) — re-run to refresh research
/uat run --l1        # cheap, mass-parallel theoretical sweep across the whole roster (no live app)
/uat run             # full L1 → L2 on survivors (start `npm run tauri:dev:test` first; serial)
/uat run --surface personas   # scope to one section
/uat promote <journey>        # freeze an L2-pass journey into an acceptance gate
```

## Character template

```markdown
---
name: <kebab-slug>
display: <Human Name>, <Role>
segment: <technical | semi-technical | non-technical | buyer | a11y | localization | power-user>
tier: <starter | team | builder>
language: <en | es | ja | de | ...>
promotion: discovery
references:
  - <url or "training-data: <topic>">
---

# <Human Name> — <Role>

## Who they are (background / lived experience)
<History, the tools they've been burned by, who they answer to, what's at stake. 3–6 sentences.>

## Voice
<How they actually talk — register, vocabulary, what they get excited or cynical about. 1–3 sentences.>

## Jobs-to-be-done
- <The concrete job they came to do.>
- <Secondary jobs.>

## What good looks like
<Their bar for a successful outcome, in their words.>

## Pet peeves
- <Things that instantly erode their trust or patience.>

## Motivation — why use the app at all (time-saved)
- **Current/manual way:** <how they do this today> — takes ~<N> <units>.
- **App should save:** <expected time/effort delta>. If it's slower or barely faster, that's a finding.

## Senior-quality bar (the reliability floor)
<What output a senior in THIS role would produce — the floor the app's AI output must clear. Be specific to the artifact: a generated prompt / triaged email / drafted reply / built connector / research synthesis.>

## Surface binding (what THEY actually reach)
- Sections: <e.g. Home, Personas, Templates, Keys, Overview>
- NOT reachable by them: <e.g. Dev Tools, Engine/BYOM/Admin settings, Cloud> (don't attribute findings here to them)

## Scored acceptance criteria (applied IDENTICALLY every run)
1. [completion] <explicit pass/fail check>
2. [time-saved] <explicit pass/fail check>
3. [senior-quality] <explicit pass/fail check>
4. [trust] <explicit pass/fail check>
5. [clarity/effort/missing] <explicit pass/fail check>
```
