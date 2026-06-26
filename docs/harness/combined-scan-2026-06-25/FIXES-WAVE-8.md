# Combined-Scan Fix Wave 8 — Credential / vault data-loss & secrets

> 3 atomic fix-commits, 5 findings closed (all High) — no deferrals.
> Dispatched as 3 parallel edit-only fix-subagents, grouped by file ownership (vault #1+#2 share credentials.rs; the two reqwest-URL leaks are one fix pattern).
> Baseline preserved: **cargo credentials 49/0 + compile; tsc 0; vitest 1977/7 (no regressions); i18n strict green**.

## Commits

| # | Commit | Finding(s) | Files |
|---|---|---|---|
| 1 | `8d28123cf` | credential-vault-crud #1 + #2 | credentials.rs, OverviewTab.tsx |
| 2 | `8d11a4c72` | credential-design #1 (blast-radius) | credentialGraph.ts, BlastRadiusPanel.tsx, i18n |
| 3 | `8f693d78e` | credential-design #2 + oauth #2 (URL leak) | credential_design.rs, api_proxy.rs |

## What was fixed

1. **Vault edit wiped unsubmitted secrets + opt-out encryption (2 findings).**
   - *#1 data-loss:* `update_with_fields` did DELETE-all + reinsert treating the form's partial map as authoritative, but the edit form never loads the decrypted stored values — so editing a display name wiped hidden `access_token`/`refresh_token` (broke OAuth) and blanked optional secrets. The update path now **merges** (omitted fields intact, blank-over-existing skipped, non-blank upserts); CREATE uses a separate `create_with_fields` and is unchanged. The form also drops blanks + shows a "leave blank to keep current" hint.
   - *#2 plaintext-at-rest:* `is_field_sensitive` trusted the connector's `sensitive` flag, so a field marked `sensitive:false` stored an api_key as cleartext. Added a **secret-name backstop**: `classify_field_type(key) == "secret"` forces encryption regardless of the flag (non-secret keys like `base_url`/`region` stay unencrypted).
2. **Blast-radius "safe to delete" lie.** Severity was computed only from affected-agent count, so a credential whose only consumers are `credentialEvents` scored "low / minimal impact" and got deleted, breaking live event triggers. `severityForBlastRadius(agents, events)` now floors at `medium` when `events > 0` (wired into analyze + simulate); the panel shows a new `impact_events` message (real translations, all locales). A truly-unused credential stays `low`.
3. **Secret leaks via reqwest error URL.** `reqwest::Error`'s Display embeds the request URL (redacts only userinfo password), so a secret in the URL (`?apikey={{api_key}}` healthcheck, `api.telegram.org/bot<token>` proxy) leaked into the AppError/log/toast. All three error-format sites now call `e.without_url()` before formatting.

## Verification

| Gate | Result |
|---|---|
| `cargo test --lib credentials` | 49 pass / 0 fail + compile |
| `tsc --noEmit` | 0 |
| `vitest run` | 1977 pass / 7 pre-existing fail (no regressions) |
| `check:i18n:strict` | green (all 16075 keys; real translations) |

## Patterns established (catalogue items 24–26)

24. **Authoritative-replace on a partial form** — a DELETE-all + reinsert from a form that doesn't load existing values silently deletes everything the form didn't show. Merge (upsert submitted, keep omitted, treat blank as "unchanged") for edits; reserve full-replace for create.
25. **Opt-out encryption gated on authorable data** — making a `sensitive` schema flag the sole source of truth lets a mis-authored connector store secrets in plaintext. Add a name/type-based backstop that force-encrypts secret-classified fields regardless of the flag.
26. **`reqwest::Error` Display leaks the URL** — it redacts the userinfo password but NOT the path/query, so any secret in the URL escapes into error strings/logs. Call `e.without_url()` (or build the message from `e.status()`/`e.is_timeout()`) before formatting.

## Cumulative status (Waves 1–8)

| Wave | Theme | Closed/addressed |
|---|---|---:|
| 1–7 | security → execution-lifecycle | 39 (6C/33H, 2C mitigated) |
| 8 | Credential / vault data-loss & secrets | 5 (5H) |

**Total: 44 findings addressed across ~58 commits, 0 regressions.** 6/6 scan Criticals fixed-or-mitigated; **38 of 81 Highs closed.**
**Remaining:** ~43 High + Med/Low tail. Next: Wave 9 — Companion / voice / fleet + knowledge/memory (STT sidecar concurrency, STT sampleRate, fleet bridge records nothing, pipeline conditional-skip, team-assignment manual-resolve cascade, memory merge deletes pinned, LLM review clobbers importance).
