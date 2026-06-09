# Bug Hunter — personal-twin
> Total: 6
> Severity: 1 critical, 3 high, 2 medium, 0 low

## 1. Approving a twin-authored reply feeds the twin's own output back into its memory inbox (self-reinforcing corruption loop)
- **Severity**: critical
- **Category**: state-corruption
- **File**: src/features/plugins/twin/sub_channels/ReplyOutbox.tsx:115-121 (→ src/stores/slices/system/twinSlice.ts:487-499 → src-tauri/src/db/repos/twin.rs:583-607)
- **Scenario**: Operator generates a draft reply, clicks "Approve & log". `handleApprove` calls `recordInteraction(activeTwinId, draftContext.channel, 'out', replyDraft.trim(), draftContext.contactHandle)` with **no `createMemory` argument**. The store passes `createMemory` as `undefined` (twinSlice.ts:489), the API forwards `undefined` (twin.ts:213), and the Rust handler defaults it to `true` (`create_memory.unwrap_or(true)`, twin.rs handler `twin_record_interaction`). `record_interaction` (repo twin.rs:583) therefore queues a pending memory built from the *twin's own generated reply text*. Approve that memory in the Knowledge tab → it becomes an "approved memory", gets compiled into the wiki and distilled into facts, which then ground the *next* `twin_draft_reply` (twin.rs build_reply_prompt facts_block) — the model is now learning its own prior hallucinations as ground truth.
- **Root cause**: The "log a sent message" path and the "capture a memory worth reviewing" path share one command whose memory side-effect defaults ON. Outbound, machine-generated content is treated as a knowledge source identical to a real inbound human message.
- **Impact**: corruption — distilled facts/wiki progressively poisoned with the twin's own fabricated specifics; bad content compounds into worse content with each reply cycle.
- **Fix sketch**: Pass `createMemory: false` explicitly for operator-approved outbound drafts (the draft is not new knowledge). Better: make `create_memory` default to `false` and require callers to opt in, and never auto-memory `direction == "out"` content the twin itself authored.

## 2. record_interaction silently drops the pending-memory enqueue failure → approval gate bypassed while message shows as "sent"
- **Severity**: high
- **Category**: silent-failure
- **File**: src-tauri/src/db/repos/twin.rs:598-606
- **Scenario**: `record_interaction` inserts the communication row, then does `let _ = create_pending_memory(...)`. `create_pending_memory` opens its own pooled connection (twin.rs:453) and can fail (pool exhausted, transient lock, disk-full). The `let _ =` discards the `Result`. The function then re-reads and returns the communication as a full success. The operator sees "Recording…" → success, the comm appears in history, but the human-review memory never entered the inbox. For URL ingest / wiki audit (twin.rs:1616, 1858) the same `create_pending_memory` errors *do* propagate; only the per-interaction path swallows them — inconsistent and the one most tied to the autonomous "speaks as me" surface.
- **Root cause**: Best-effort side-effect on the critical review path, plus non-atomic multi-connection writes (comm insert and memory insert are on different connections, no transaction) so a crash between them leaves a communication with no review record.
- **Impact**: data loss / security — content the twin authored is logged as sent but escapes the human-approval workflow entirely; reviewer believes everything in the inbox is the full set.
- **Fix sketch**: Wrap the comm insert + memory insert in one `conn.transaction()`; propagate the `create_pending_memory` error (`?`) instead of `let _ =`, or at minimum log + surface a partial-success flag so the UI can warn that the review item is missing.

## 3. Persona resolves to the wrong twin identity on any credential-read failure (silent fallthrough to global active)
- **Severity**: high
- **Category**: edge-case
- **File**: src-tauri/src/commands/infrastructure/twin.rs:267-310
- **Scenario**: A persona is bound to "Founder Twin" via `credential_links["twin"]`. At runtime `get_decrypted_fields` fails (vault locked, key rotated, decrypt error) or the bound `twin_profile_id` no longer resolves — every branch uses `if let Ok(...)` / `.filter(...)` with no else, so control falls through to step 3, `repo::get_active_profile`, returning the *globally active* twin (e.g. "Personal Twin"). The persona then authors communications, recall facts, and tone in the **wrong identity** with zero signal. Same fallthrough on `Err(AppError::NotFound)` for the persona id (twin.rs:301).
- **Root cause**: "Never crash a persona mid-execution" was implemented as "silently substitute a different identity" rather than "fail closed / surface that the intended twin is unavailable."
- **Impact**: corruption / security — twin speaks as the wrong person; private facts from the global twin can leak into a channel meant for a different persona's twin.
- **Fix sketch**: Distinguish "no binding configured" (legitimate → fall through) from "binding configured but unresolvable" (error → return `Err` or `Ok(None)` so the caller refuses to author rather than impersonating a different twin). Log a warning on every fallthrough.

## 4. Pending-memory review race surfaces the losing side as a hard "not found" error although intent succeeded
- **Severity**: high
- **Category**: race-condition
- **File**: src-tauri/src/db/repos/twin.rs:468-485 (→ src/stores/slices/system/twinSlice.ts:459-471, src/features/plugins/twin/sub_knowledge/KnowledgeAtelier.tsx:106-147)
- **Scenario**: The DB write is correctly guarded (`WHERE id = ?1 AND status = 'pending'`), so approve+reject can't *both* win. But two surfaces can target the same row near-simultaneously: (a) two app windows both showing the pending item, or (b) the "Dig deeper" gesture which calls `reviewMemory(memId, true, 'dig_deeper')` (KnowledgeAtelier.tsx:138) after an async `generateBio` round-trip while the plain Approve/Reject buttons remain clickable on other rows. The first call flips status; the second matches 0 rows and returns `AppError::NotFound("...already reviewed or not found")` (twin.rs:482). `reviewTwinMemory` catches it via `reportError` (twinSlice.ts:468), leaving the optimistic list untouched — the user who "lost" sees a scary not-found error and a row whose displayed status never refreshes to the winning value until a manual refetch.
- **Root cause**: The atomic guard returns an error indistinguishable from "row deleted", and the client never reconciles to the authoritative current row on conflict.
- **Impact**: UX degradation / state-corruption (displayed status diverges from DB) — operator can't tell whether their decision or a concurrent one took effect.
- **Fix sketch**: On 0-row update, re-SELECT the row and return it with an `already_reviewed` marker instead of `NotFound`; client treats that as "settled, here's the authoritative state" and reconciles the list rather than toasting an error.

## 5. Create-twin wizard URL ingest always silently fails and fabricates a placeholder bio (success theater)
- **Severity**: medium
- **Category**: silent-failure
- **File**: src/features/plugins/twin/sub_profiles/CreateTwinWizard.tsx:103-117 (api src/api/twin/twin.ts:381-382)
- **Scenario**: `handleIngestUrl` calls `twinApi.ingestUrl(bioUrl.trim())` with no second argument. The wrapper signature is `ingestUrl(url, twinId?)` and forwards `{ url, twinId: undefined }`, but the Rust command `twin_ingest_url` declares `twin_id: String` (non-optional, twin.rs:1527-1531). Tauri deserialization fails for the missing required arg, the call rejects, and the bare `catch {}` (CreateTwinWizard.tsx:112) swallows it and sets `bio` to `"Bio to be filled — failed to ingest <url>."`. The user is never told ingestion is broken; they see a plausible-looking placeholder.
- **Root cause**: API wrapper made `twinId` optional to fit a caller that has no twin yet, but the backend never supported a twin-less ingest; the empty `catch` hides the contract mismatch.
- **Impact**: UX degradation — a headline wizard feature is non-functional and disguised as a result.
- **Fix sketch**: Either defer URL ingest until after the twin row exists (call with the created `profile.id`), or add a twin-less ingest path; replace the bare `catch {}` with a visible error so a broken contract can't masquerade as a bio.

## 6. Voice profile slider values default-coerced server-side, masking partial/stale upserts
- **Severity**: medium
- **Category**: state-corruption
- **File**: src-tauri/src/commands/infrastructure/twin.rs:529-552 (repo twin.rs:654-690)
- **Scenario**: `twin_upsert_voice_profile` takes `stability/similarity_boost/style` as `Option<f64>` and applies `unwrap_or(0.5/0.75/0.0)`. The UI `upsertVoiceProfile` (twinSlice.ts:515) forwards whatever the caller passes; any code path that updates *one* field (e.g. only `voice_id`) without re-sending the sliders silently resets the others to hard defaults via the UPSERT `DO UPDATE SET ... = excluded.*` (repo twin.rs:672-679). The operator believes they tuned stability to 0.9; a later partial save snaps it back to 0.5 with no diff shown.
- **Root cause**: Coalescing absent optionals to literals at the command boundary makes "field omitted" indistinguishable from "field set to default" in a full-row UPSERT.
- **Impact**: corruption / UX degradation — voice characteristics applied from stale/reset state; the twin speaks with the wrong configured voice after an unrelated edit.
- **Fix sketch**: Read-modify-write (load existing row, only overwrite provided fields) or make the UPSERT `COALESCE(excluded.x, voice_profiles.x)` so omitted optionals preserve the stored value instead of resetting to a literal.
