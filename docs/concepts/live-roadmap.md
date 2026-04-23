# Live Roadmap

Make the in-app Roadmap view (the special `roadmap` release inside "What's New") fetch its content from a published source at runtime, instead of being baked into the desktop binary at build time. The developer edits the roadmap once, every desktop user sees the update on next launch — no app release required.

This document is the implementation contract for **Variant A (Static JSON over CDN)**, which we are shipping in this session. **Variant B (Supabase + Realtime)** is preserved at the bottom as a forward-looking option: not chosen now, kept to bound future work and capture the migration triggers so we don't drift toward it accidentally.

---

## Goal & non-goals

**Goals**
- Roadmap content (titles, descriptions, status, priority, sort order) is fetchable at runtime without shipping a new app build.
- Existing visual design, i18n model, and the `roadmap` view stay untouched — only the data source changes.
- App always renders something. If fetch fails, falls back silently to the bundled JSON. If even that's stale, the user sees stale-but-valid content, not an error wall.
- Editing the roadmap is a `git push` — same muscle memory as a code change, full audit trail in commit history.

**Non-goals**
- Two-way features (votes, follows, comments) — out of scope; that's a Variant B trigger.
- Per-user or per-segment roadmap content — everyone sees the same content.
- Realtime push while the roadmap view is open — also a Variant B trigger.
- Replacing the bundled `releases.json` for non-roadmap releases (changelog tabs). This change applies only to the `roadmap` entry; shipped versions stay as bundled content because they describe what shipped *with that build*.

---

## Current state (what we're replacing)

```
Build time                       Runtime
─────────                        ───────
src/data/releases.json    ─┐
src/i18n/en.ts            ─┼──>  Vite bundle  ──>  HomeRoadmapView
                                                    reads via
                                                    useReleasesTranslation
```

- `src/data/releases.json` is the structural source of truth (item ids, type, status, priority, sort_order).
- `src/i18n/en.ts` → `releases.whats_new.release_roadmap_*` carries titles + descriptions per locale (English authoritative; non-English deep-merge fall back to English).
- Both are imported synchronously at build time. To update the roadmap today, you edit one or both files, push, cut a release.

---

## Variant A — Static JSON over CDN  *(chosen, implementing now)*

### Architecture

```
                       ┌─────────────────────┐
                       │  personas-web repo  │
                       │  /public/roadmap/   │
   Developer push ───> │     v1.json         │
                       └──────────┬──────────┘
                                  │  GitHub Pages / Vercel auto-deploy
                                  v
                       ┌──────────────────────────────┐
                       │  https://personas.so/        │
                       │     roadmap/v1.json          │   <- canonical URL
                       └──────────────┬───────────────┘
                                      │  HTTPS GET (with ETag)
                                      v
                       ┌──────────────────────────────┐
   Tauri Rust  <───────│  fetch_roadmap()  command    │
   (reqwest)           │   - timeout 5s               │
                       │   - validate schema          │
                       │   - cache to disk            │
                       └──────────────┬───────────────┘
                                      │  IPC (invokeWithTimeout)
                                      v
                       ┌──────────────────────────────┐
                       │  useLiveRoadmap() React hook │
                       │   merges with i18n strings   │
                       └──────────────┬───────────────┘
                                      v
                              HomeRoadmapView
```

Bundled `releases.json` stays in the binary as the **first-paint and offline fallback**. The fetched content overrides only the `roadmap` release entry, and only when the fetch succeeds and the schema validates.

### Hosting decision

**Pick: `personas-web` repo, `/public/roadmap/v1.json`, served by the existing personas.so deploy.**

Rationale:
- `personas-web` is already deployed and CDN-fronted.
- Same repo as the marketing site, so the roadmap is one `git push` away from also updating the public guide pages.
- Versioned URL path (`v1.json`) lets us evolve the schema without breaking older app versions still in the wild.

Alternative considered: `cdn.jsdelivr.net/gh/<owner>/<repo>@main/roadmap.json`. Rejected because it adds a third-party dependency and the staleness behavior on `@main` is opaque (~12h aggressive cache).

Alternative considered: a standalone `personas-roadmap` repo. Rejected because two-repo coordination adds friction with no clear payoff.

### File schema

One file, all locales inline. Roadmap is small (4 items today, won't exceed ~30) — combined file stays under 30 KB even with 14 locales, and the savings from per-locale splitting aren't worth the request count.

```json
{
  "schema_version": 1,
  "generated_at": "2026-04-23T12:34:56Z",
  "release": {
    "version": "roadmap",
    "status": "roadmap",
    "items": [
      {
        "id": "2",
        "type": "feature",
        "status": "in_progress",
        "priority": "now",
        "sort_order": 1
      }
    ]
  },
  "i18n": {
    "en": {
      "label": "Roadmap",
      "summary": "What we're working on next.",
      "items": {
        "2": { "title": "...", "description": "..." }
      }
    },
    "de": { /* same shape; missing keys fall back to en */ }
  }
}
```

**Schema rules:**
- `schema_version` MUST be present; the app rejects payloads with an unsupported version and falls back to bundled content. Never reuse a version number.
- `release.items[].id` MUST be a string. Numeric ids (`"2"`, `"3"`) are fine — they match the existing convention in `releases.json`.
- `i18n.en` is the single required locale block. All others are optional; missing locales fall back to `en` via the existing deep-merge loader behavior.
- Unknown top-level keys are ignored (forward-compatible).
- Items missing from `i18n.en` get rendered with the placeholder string `[roadmap.<id>]` — same fallback the current bundled view uses.

### Transport: Tauri Rust command

Fetching happens in Rust, not JS, for three reasons:
1. The desktop app already centralizes external HTTP under `src-tauri/src/commands/` so timeouts, retries, and proxy config can be enforced once.
2. CORS is not a concern from Tauri's webview but `reqwest` gives a cleaner error surface than `fetch`.
3. Disk cache is trivial via `dirs` / `app_data_dir()`.

**New file: `src-tauri/src/commands/live_roadmap.rs`**

Surface (called via `invokeWithTimeout`):
```rust
#[tauri::command]
pub async fn fetch_roadmap(force: bool) -> Result<LiveRoadmap, String>
```

Behaviour:
1. If `force == false` and a cached payload exists with `cached_at` < 1 hour ago, return the cache. Skip network.
2. Otherwise GET `https://personas.so/roadmap/v1.json` with:
   - 5-second connect timeout, 5-second read timeout.
   - `If-None-Match` header from cached `ETag` (saves bytes + lets the CDN return 304).
   - `User-Agent: PersonasDesktop/<version>`.
3. On `200`: parse + validate (`schema_version == 1`, required fields present). Write to disk: `<app_data>/roadmap_cache.json`. Return parsed payload.
4. On `304`: bump `cached_at`, return cached payload.
5. On any error (network, timeout, parse, schema mismatch): return cached payload if any; else return `Err(...)`. Frontend interprets `Err` as "use bundled content".

Cache file path: `app_data_dir().join("roadmap_cache.json")`. Whatever the platform default app data dir is.

Register the command in `src-tauri/src/lib.rs` `invoke_handler` per the project's "Adding a New Integration" memory pattern.

### Frontend integration

**New file: `src/api/liveRoadmap.ts`** — thin wrapper around `invokeWithTimeout('fetch_roadmap', { force })`. Returns `LiveRoadmap | null` (null on error, never throws).

**New file: `src/features/home/components/releases/useLiveRoadmap.ts`** — React hook:
- On mount, calls `fetchLiveRoadmap({ force: false })`. Sets state to the result.
- Exposes `{ liveRoadmap, refresh, status }` where `status` is `'fresh' | 'cached' | 'fallback' | 'loading'`.
- `refresh()` calls with `force: true`.

**Edit: `src/features/home/components/releases/HomeRoadmapView.tsx`** — accept an optional `liveOverride?: LiveRoadmap` prop. When present, merge: use `liveOverride.release.items` for structural data and `liveOverride.i18n[lang] ?? liveOverride.i18n.en` for titles/descriptions, falling back to the bundled `useReleasesTranslation` for any missing labels (status names, priority names, summary pill text — those stay in the main i18n bundle since they're chrome, not content).

**Edit: `src/features/home/components/releases/HomeReleases.tsx`** — call `useLiveRoadmap()` once at the top. Pass `liveOverride` to `<HomeRoadmapView>` only when `selected.status === 'roadmap'`.

A small status pill in the roadmap view shows "Last updated 4m ago" / "Offline — showing cached" / "Refresh" so the user understands what they're looking at.

### i18n boundary

The fetched payload owns the **content** strings (item titles + descriptions, optional release label + summary). It does NOT own the **chrome** strings (status names like "In Progress", priority names like "Now", summary pill formatters like "{count} In Progress"). Those keep living in `src/i18n/en.ts` because they're tied to the UI shipped with the binary, not to roadmap content.

Practical consequence: a new roadmap status added remotely without a corresponding app release won't break — the existing status enum (`planned | in_progress | completed`) is closed; the validator rejects unknown values and the item is dropped with a console warning.

### Refresh UX

- **First app launch ever:** bundled JSON renders immediately. Background fetch starts. If it succeeds within ~3s, view re-renders with live content (no spinner, no flash since `animate-fade-slide-in` masks it).
- **Subsequent launches:** disk cache renders immediately. Background revalidate fires only if cache is older than 1 hour.
- **User on the Roadmap tab clicks refresh:** explicit force-refresh, shows spinner on the button only.
- **Network down:** silent — disk cache or bundled content covers it.
- **Schema mismatch (app too old for new payload):** bundled content used, no error shown to user. Sentry breadcrumb logged so we know to track it.

### Security

- HTTPS only; no fallback to HTTP.
- Response is plain JSON, no embedded HTML, no `dangerouslySetInnerHTML` anywhere downstream — titles/descriptions render as text only.
- Schema validation rejects unexpected types before any data hits React state. Validator is hand-written (no zod dep added for this), since the schema is small.
- The bundled fallback means a compromised CDN cannot brick the Roadmap view — worst case it can serve stale or empty payloads, both handled.
- No auth, no API keys, no user data sent. Public marketing content.

### Rollout phases

Implementation in this session breaks into 3 plans. Each is independently reviewable and ships behind the previous one without breaking anything.

| Plan | Scope | Done when |
|---|---|---|
| **P1** | `live_roadmap.rs` Tauri command + cache + schema validator + unit tests | `npx tsc --noEmit` clean, `cargo build` clean, command callable from devtools |
| **P2** | `useLiveRoadmap` hook + `liveOverride` integration in `HomeRoadmapView` + `HomeReleases` wiring | Reload Roadmap tab, mock command response in devtools, view updates |
| **P3** | Initial `roadmap/v1.json` published to `personas-web` + status pill UX in roadmap view | Live URL returns 200; pill shows "Updated Xm ago" after refresh |

P1 + P2 ship the plumbing; the desktop app falls back to bundled content the entire time so behavior is unchanged for users until P3 publishes the live file.

### Known limitations / explicit acceptances

- **Update latency: 30s–5min** between push and what users see (CDN propagation + 1h client cache, unless they refresh manually). Acceptable for a roadmap; not acceptable for a real-time feature.
- **No analytics:** we won't know which items get attention. Acceptable for now.
- **Single document:** every fetch is a full re-download. At ~30 KB this is fine; ETag/304 keeps it cheap.
- **No editor UI:** edits go via PR. Acceptable because the only editor is you.

---

## Variant B — Supabase + Realtime  *(deferred, future-state)*

Captured here as a forward reference. **Do not implement now.** This section exists so future maintainers (including future-us) understand what migrating *to* would look like, and what evidence should trigger that migration.

### When to revisit Variant B (decision triggers)

Migrate from A → B when **two or more** of the following are true:

1. **Edit cadence exceeds ~3 roadmap changes per week**, and the PR overhead becomes friction.
2. **A non-engineering teammate needs edit access** (PM, marketing) and the git workflow is a barrier.
3. **You want to know which roadmap items users care about** (hover counts, click-throughs) — i.e. analytics on the roadmap itself becomes a real requirement.
4. **You want roadmap items to update live while users are looking at the page**, not on next refresh.
5. **You want users to interact with roadmap items** — vote, follow, comment, request notification when an item ships.
6. **The roadmap becomes user-segmented** (different content for different plan tiers, or per-org roadmaps).

If only one trigger fires, that's not enough — solve it with a smaller change inside Variant A first.

### Sketch of Variant B architecture

```
   Admin UI in personas-web   ──┐
   (or Supabase Studio)         │ writes
                                v
                       ┌──────────────────────────┐
                       │  Supabase Postgres        │
                       │   roadmap_items table     │
                       │   roadmap_translations t. │
                       │   RLS: public select only │
                       └──────────────┬───────────┘
                                      │ supabase-js
                                      │ - REST for initial load
                                      │ - Realtime for live updates
                                      v
                       ┌──────────────────────────┐
                       │  useLiveRoadmap() hook   │  <- same surface as A
                       │   subscribes when view    │
                       │   is mounted              │
                       └──────────────┬───────────┘
                                      v
                              HomeRoadmapView
```

### Migration path A → B

The whole point of Variant A's design is that the React-side surface (`useLiveRoadmap` hook, `liveOverride` prop, `LiveRoadmap` type) is **transport-agnostic**. To move to B:

1. Add a `roadmap_items` + `roadmap_translations` schema in Supabase, RLS = public select.
2. Build a one-time migration script that takes the current `roadmap/v1.json` and writes rows.
3. Replace the body of `fetchLiveRoadmap()` to call Supabase REST instead of GET-ing the JSON. Same return shape.
4. Add Realtime subscription inside the existing `useLiveRoadmap()` hook — appends a `supabase.channel().on('postgres_changes', ...)` setup that calls `setLiveRoadmap()` on event.
5. Decommission the `personas-web` `roadmap/v1.json` route (or keep as a Supabase-fed mirror for offline fallback).

The desktop-side code that consumes `LiveRoadmap` (`HomeRoadmapView`, the merge logic, the status pill) does not change at all. That's the architectural payoff of designing A's hook surface this way.

### Costs / risks of B

- **Vendor lock-in** to Supabase. Realistic given existing infra patterns but worth naming.
- **Schema migrations** become a real concern once shipped — wrong-shape data in production needs rollback paths.
- **Anon key in the binary.** Low value to an attacker (read-only public data via RLS), but it's a key in the bundle and people will ask about it in security reviews.
- **An admin UI** is real engineering work, not a free side-effect.

---

## References

- Existing data layer: [`src/data/releases.ts`](../../src/data/releases.ts), [`src/data/releases.json`](../../src/data/releases.json)
- Existing view: [`src/features/home/components/releases/HomeRoadmapView.tsx`](../../src/features/home/components/releases/HomeRoadmapView.tsx)
- i18n source: [`src/i18n/en.ts`](../../src/i18n/en.ts) → `releases.whats_new.*`
- IPC pattern: [`src/lib/tauriInvoke.ts`](../../src/lib/tauriInvoke.ts), CLAUDE.md → "Tauri IPC"
- Integration scaffold pattern: project memory → "Adding a New Integration"
