# Audit Fix Wave 9 — Destructive-confirm + broken/divergent UI (Tier-2 final)

> 5 commits, 5 of 6 critical UI findings closed; 1 deferred (needs a backend payload field).
> Theme: the highest-stakes actions were the *least* guarded (delete/send-as-user fired on one click), and core shared UI was silently broken or forked (a dead CSS class, two status vocabularies, a hand-rolled secret input).
> Baseline preserved: `tsc --noEmit` 0; eslint 0 errors (warnings only — intentional inline strings + pre-existing low-contrast classes on untouched lines).
> Branch: `vibeman/audit-2026-06-09`.

## Commits

| Commit | Finding | Files |
|---|---|---|
| `ace641287` | templates #1 — preset accent strip uses a dead class | `templates/sub_presets/PresetLibraryPage.tsx` |
| `729a6d5f1` | creative #3 — single-image delete, no confirm, off-palette | `plugins/artist/sub_gallery/AssetCard.tsx` |
| `617dcdffa` | personal-twin #1 — "Approve & log" sends-as-user, no confirm | `plugins/twin/sub_channels/ReplyOutbox.tsx` |
| `e7068b3d2` | settings/byom #1 — secret input reinvented | `settings/sub_byom/components/ByomApiKeyManager.tsx` |
| `5876efd45` | teams #1 — two step-status visual vocabularies | `teams/sub_teamWorkspace/teamStudio/teamStudioShared.tsx` |

## What was fixed

1. **templates #1** — the preset card's signature color bar used a non-existent class `absolute-top-strip` on a non-positioned parent, so it rendered as a faint inset line instead of the intended card-top accent (broken catalog-wide). Card is now `relative overflow-hidden` and the strip is `absolute top-0 inset-x-0 h-[3px]` — a proper full-width top accent in the preset color.
2. **creative #3** — the gallery card trash button deleted an asset on a single hover-click with no confirm, while the same app's Drive plugin always confirms deletes. Gated behind the shared `ConfirmDialog` (danger), added an `aria-label`, and switched the off-palette `red-500` tint to the artist `rose` accent used across the card.
3. **personal-twin #1** — "Approve & log" recorded an outbound reply attributed to the user with zero confirmation while lower-stakes deletes were gated. Now routes through `ConfirmDialog` naming the channel/contact before the attributed send.
4. **settings/byom #1** — BYOM secret keys were typed into a plain `type=text` input (never treated as a password by OS/AT), the reveal toggle exposed only a `title`, and a stored key could not be copied. Editor secrets now use the shared `PasswordToggleField` (real `type=password` + reveal + aria + 8s auto-mask); the display reveal button gets `aria-label`/`aria-pressed`; and a copy affordance was added. URL fields keep the plain input.
5. **teams #1** — the Orchestration Console kept its own step-status map (`matching`=amber dot, `running`=pulsing dot) that disagreed with the Flight Deck relay's canonical `stepMeta` (`matching`=violet Wand2, `running`=spinning Loader2) for the same 7 statuses. The console `StepStatusBadge` now derives icon+color from boardShared's `stepMeta()` (labels stay localized via i18n) and the duplicate `STEP_STATUS_STYLE` map is deleted, so both surfaces paint each status identically.

## Verification

| Gate | Result |
|---|---|
| `tsc --noEmit` | 0 |
| `eslint` (staged) | 0 errors (warnings only, baseline) |
| `cargo check` | n/a (no Rust this wave) |

## Deferred (1 of 6)

- **cloud-sync #1 — approval prompt can't show which device requested the run.** The `RemoteCommand` binding (`src/lib/bindings/RemoteCommand.ts`) carries **no** device/origin field at all — provenance is structurally absent from the data, not just the markup. Surfacing "from which device" on this remote-code-execution approval gate requires the backend `RemoteCommand` payload to include an `origin`/`requestedFrom` field, a TS binding regen, and the frontend chip — then runtime validation against a real second device. The report itself notes the finding "documents the data+UI gap" until the field exists. Deferred as cross-layer infra. (Related lower-severity gaps on the same prompt — no expiry countdown #2, unguarded Reject #3, missing `commandType` display #4, no `aria-describedby` #5 — are Tier-3 follow-ups.)

## Patterns reinforced (catalogue, continued)

32. **Guard weight must track real risk.** The most destructive/irreversible action on a surface (delete, send-as-user, overwrite-a-secret) must be the *most* gated — route it through the shared `ConfirmDialog` (`danger`) or make it reversible. A one-click hover-delete next to a gated low-stakes action is the inversion to hunt for.
33. **Don't reinvent a primitive that exists next door.** Secret inputs → `PasswordToggleField`; confirms → `ConfirmDialog`; status → the canonical `stepMeta`. A hand-rolled copy drifts (wrong colors, plain-text secrets, missing aria). Grep for the shared component before writing a local one.
34. **A dead utility class fails silently.** `className="absolute-top-strip …"` where the class is defined nowhere is a no-op, not an error — the element just renders wrong. When a layout looks subtly off, grep the class name across the repo; zero hits = typo/dead class.
35. **One status set, one vocabulary.** When two views render the same enum, they must share one icon+color map. Keep the labels localized per-view if needed, but derive the *visual* from a single exported source (here `stepMeta()`), and delete the duplicate map so it can't drift again.

## Cumulative status

| Tier | Wave | Theme | Closed |
|---|---|---|---|
| 1 | 1 | Lost-update writes | 8/8 |
| 1 | 2 | Transition guards & lock leaks | 5/7 |
| 1 | 3 | Success theater | 4/7 |
| 1 | 4 | Orphaned processes | 5/5 |
| 1 | 5 | Security | 6/7 |
| 1 | 6 | Corruption loops & integrity | 5/7 |
| 2 | 7 | Error-blind UI surfaces | 6/7 |
| 2 | 8 | Critical accessibility | 5/6 |
| 2 | 9 | Destructive-confirm + broken UI | 5/6 |
| | | **Total criticals fixed** | **49** |

**Tier-1 + Tier-2 critical waves are now complete: 49 of 60 criticals fixed, 11 deferred.** The 11 deferred all need runtime-validated infra or a cross-layer payload/binding change (8 Tier-1: teams double-run, webhook re-delivery, approval channel, research run-row, lab version_id, persona-chat stream race, p2p signed handshake, obsidian conflicts; + research-lab error states; + canvas a11y; + cloud-sync origin field).

Remaining audit scope: the 11 deferred items, and the **169 Tier-3 high-severity findings** (groupable into themed waves like the criticals).
