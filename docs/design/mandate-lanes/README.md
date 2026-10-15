# Mandate Lanes - design reference

The prototype the owner shortlisted in contest `human-loop` (round 3, entry B/1), kept here as the reference for
`PLAN.md`.

- `prototype/` - the page exactly as judged. It loads `../data/decisions.js`, `../data/ui/tokens.css`,
  `../data/ui/typography.css` and `../data/ui/fleet.js`; that 16 MB synthetic dataset is NOT committed. To open it,
  use the local contest arena (`.contest/arena/human-loop-r2-r3/judging/entries/B/`) or copy `data/` beside this folder.
- `prototype-perfect/` - an interrupted refinement pass: `model.js` adds re-read reasons, widen/narrow evidence and
  Athena-drafted orphan clusters; `parts.js` adds a fold section; `cards.css` tightens spacing. The engine is coherent
  but was never wired into the page (re-read cards render broken). Port the law, not the code (plan WP6).

All text and numbers in the prototype are synthetic.
