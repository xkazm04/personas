---
slug: untrusted-card-content
type: perfect/direction
context: "[[agents-quick-answer]]"
lens: wildcard
status: rejected
size: S
proposed: 2026-08-05
accepted: —
shipped: —
commit: —
---
## What & why

Card bodies are agent- and LLM-authored, including cloud-sourced reviews. The markdown
renderer sanitizes links and renders images raw, so a crafted body can make the desktop app
fetch an attacker-controlled or internal URL on render.

## Evidence

- `MarkdownRenderer.tsx:320-322` — `img: ({ src, alt }) => <img src={src} ... />`, no check.
- Links ARE sanitized (`:307-315`, via `sanitizeExternalUrl`), so the omission is asymmetric.
- No `rehype-raw`, no `rehype-sanitize` — neither is installed. `dompurify` is in the repo
  (`src/lib/utils/sanitizers/sanitizeHtml.ts`) but not imported here.
- `sanitizeIconUrl` exists for exactly this case — its own doc says it "Prevents SSRF,
  tracking pixels, IP leakage" and it blocks private/local hostnames
  (`sanitizeUrl.ts:1-12,62-82`).
- Bodies carry remote content: `triageAdapters.ts:662,794,906,1189`, including cloud reviews.

## Outcome — REJECTED 2026-08-05

Declined at the gate; the only one of five not accepted. The presentation explicitly flagged
that the fix lands in the shared `MarkdownRenderer`, outside this context — the most likely
reason, and a legitimate one: a quick-answer direction should not carry app-wide blast
radius.

**The finding stands and is real.** Do not re-propose it as a quick-answer direction.
Re-raise it against whichever context owns `src/features/shared/components/editors/`, where
the blast radius belongs to the context doing the work. Every consumer of
`MarkdownRenderer` is exposed, not just the deck.

## Build record

Not built.
