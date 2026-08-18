---
layer: application
subject: prompt-safety
technique: output-sanitization
stack: react
---

# Output sanitization on the display side

The frontend's sanitizer family lives in `src/lib/utils/sanitizers/` and
treats everything that came out of an execution — model output, error
messages, connector metadata — as untrusted input to the screen, the crash
log, and the error tracker.

## Secret masking before display and telemetry

`maskSensitive.ts` carries both halves of the display-side masking pass:

- `maskSensitiveJson` (`maskSensitive.ts:40-49`) parses, walks, and
  re-serializes JSON, masking values whose keys match the sensitive-key
  vocabulary (`SENSITIVE_KEY_RE`, `:10-11`) — used by the execution list row,
  the execution detail modal, crash persistence, and the Sentry scrubber.
- `sanitizeErrorMessage` (`:109-141`) scrubs error text: URLs are parsed and
  their query/fragment (where tokens live) stripped *first*, stashed behind
  placeholders so the file-path pass cannot shred them (`:117-130` — the
  comment documents the real bug this ordering fixed), then paths, IPs,
  internal hostnames, emails, labeled key:value secrets, and prefixed token
  shapes are replaced.
- The token-class patterns (`PREFIXED_SECRET_RE`, `:102-103`) are the
  standard's precision story in the negative: the 2026-08-15 in-file
  correction (`:85-101`) records that the previous regex **could not match
  any token one issuer has ever issued** — the fix already existed in
  `src-tauri/core/src/redact.rs`, a different module in a different language,
  "which is why nothing noticed." The per-class forms are now copied from
  there, with the comment as the mirror marker; the shared cross-language
  test corpus the technique calls for still does not exist.

The backend sibling, `redact.rs`, additionally demonstrates the
precision-bias rule: its entropy sweep refuses pure-hex tokens (UUIDs, git
SHAs) and demands mixed character classes (`redact.rs:132-152`), because a
default-on masker that corrupts identifiers gets kill-switched
(`REDACT_TRACES_ENABLED`, `:31-45`).

## Link schemes: allowlist, parsed, checked before trim

`sanitizeUrl.ts` is the scheme-allowlist rule as shipped code:

- `sanitizeExternalUrl` (`sanitizeUrl.ts:93-115`) admits only `http:`/`https:`
  via the **parsed** protocol, rejects embedded credentials and hostless
  URLs, and — the detail worth stealing — runs `hasUnsafeCodepoints` on the
  *untrimmed* input (`:96-98`), because trim itself strips the BOM and
  zero-width characters an attacker uses to disguise a scheme, letting them
  "slip past the check."
- `hasUnsafeCodepoints` (`:35-56`) enumerates the disguise alphabet: C0/C1
  controls, zero-widths, bidi overrides and isolates, line separators, BOM.
- `sanitizeIconUrl` (`:62-82`) is stricter for image sources — `https:` only,
  private/local hostnames blocked (`isBlockedHostname`, `:24-26`, exported so
  other sanitizers share the one blocklist rather than growing copies).

Callers get `null` for anything unsafe and must fall back to a placeholder —
reject, not repair.

## The known gap this application confirms

The markup half of the technique is server-side here: `strip_html_tags`
(`src-tauri/core/src/validation/mod.rs:11-27`) strips tags via an allowlist
sanitizer with an *empty* allowlist, then decodes entities back **once** for
readability. That is a single decode after the strip, not the fixpoint the
technique requires — once-encoded markup survives as live-looking text whose
safety depends on every downstream renderer escaping. Deviation reported;
standard kept.
