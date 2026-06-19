# Accepted gaps (baseline)

Known-and-accepted issues that should NOT re-surface as findings. Append a row when the user accepts a gap. Each entry suppresses a finding by `(journey, dimension, title)` match.

> Empty at init. The first `/uat run` will surface candidates; the user decides which become accepted gaps here vs. backlog.

| Date | Journey | Dimension | Title | Why accepted | Accepted by |
|---|---|---|---|---|---|
| — | — | — | — | — | — |

## Standing scope notes (not defects)

- **`dev`-only surfaces** (Settings → Engine/BYOM/Admin, Home → system-check, parts of Dev Tools) are hidden in shipped builds. A Character on a shipped tier cannot reach them — `scope_note`, not a defect.
- **Tier-gated features** above a Character's plan (Starter/Team/Builder) are out-of-scope for that Character.
- **Translation lag:** non-English locales fall back to English by design; a missing translation is `minor` at most unless it blocks a core flow for a localization Character.
- **Model output variance:** a single bad generation is `uncertain` until multi-sampled (2–3 runs, majority).
