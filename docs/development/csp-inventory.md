# CSP Inventory — `tauri.conf.json` security.csp

Provenance map for every domain in the canonical CSP. When you add or remove
a feature that needs network access, update this doc in the same change so
future contributors can audit which entries are still load-bearing.

The canonical CSP lives at [`src-tauri/tauri.conf.json` `security.csp`](../../src-tauri/tauri.conf.json).
A near-identical `devCsp` exists alongside it for `npm run dev` (adds
`http://localhost:*` + `ws://localhost:*` for the Vite dev server).

The Android variant in `tauri.android.conf.json` deliberately strips most
mobile-irrelevant entries (no media, no frame, no YouTube). Update it
separately if the entry is needed on Android.

## Per-directive inventory

### `script-src`

| Domain | Feature | Why |
|---|---|---|
| `'self'` | always | Bundled JS |
| `https://www.youtube.com` | radio (YouTube tracks) | IFrame Player API bootstrap |
| `https://s.ytimg.com` | radio (YouTube tracks) | YouTube static assets used by the IFrame Player |

### `style-src`

| Domain | Feature | Why |
|---|---|---|
| `'self'` | always | Bundled CSS |
| `'unsafe-inline'` | always | Tailwind utility classes / inline component styles |

### `img-src`

| Domain | Feature | Why |
|---|---|---|
| `'self'`, `data:`, `blob:` | always | Bundled assets + generated previews |
| `asset:`, `http://asset.localhost`, `https://asset.localhost` | always | Tauri 2 asset protocol |
| `https://cdn.simpleicons.org` | shared | Connector / brand icons |
| `https://lh3.googleusercontent.com` | OAuth (Google) | OAuth provider avatars |
| `https://i.ytimg.com`, `https://yt3.ggpht.com` | radio (YouTube tracks) | Video thumbnails + channel avatars |

### `connect-src`

| Domain | Feature | Why |
|---|---|---|
| `'self'` | always | First-party fetch |
| `asset:`, `http://asset.localhost`, `https://asset.localhost` | always | Tauri asset protocol |
| `https://raw.githubusercontent.com` | code-share / templates | Raw file fetches for shared snippets and template seeds |
| `https://gist.githubusercontent.com` | code-share | Gist content fetches |
| `https://github.com` | dev-tools / sharing | GitHub API + repo metadata |
| `https://*.ingest.sentry.io` | error reporting (always-on) | Sentry envelope endpoint |
| `https://export.arxiv.org` | research-lab | ArXiv literature export |
| `https://*.somafm.com` | radio (SomaFM streams) | Direct stream URL |
| `https://www.youtube.com` | radio (YouTube tracks) | IFrame Player metadata fetches |
| `https://*.googlevideo.com` | radio (YouTube tracks) | YouTube playback CDN (video chunks) |

### `frame-src`

| Domain | Feature | Why |
|---|---|---|
| `https://www.youtube.com` | radio (YouTube tracks) | IFrame Player embed origin |
| `https://www.youtube-nocookie.com` | radio (YouTube tracks) | Privacy-enhanced YouTube embed origin |

### `media-src`

| Domain | Feature | Why |
|---|---|---|
| `'self'`, `blob:` | always | Bundled audio + recorded blobs (companion-tts samples, etc.) |
| `asset:`, `http://asset.localhost`, `https://asset.localhost` | always | Tauri asset protocol |
| `https://*.somafm.com` | radio (SomaFM streams) | Direct audio stream playback |
| `https://*.googlevideo.com` | radio (YouTube tracks) | YouTube playback CDN |

### `font-src`, `object-src`, `base-uri`, `form-action`, `worker-src`, `manifest-src`

These are the strict defaults: `'self'` everywhere except `object-src 'none'`. Don't relax without an explicit security review.

## When you add a CSP entry

1. Decide whether dev-only (devCsp) or production (csp) or both.
2. Use the tightest scheme/host you can — prefer `https://example.com` over `https://*.example.com` over `https:`.
3. Update this doc in the same PR.
4. Run `npm run check:tauri-configs` to confirm overlay merge still works.
5. Cross-check `tauri.android.conf.json` if the entry is platform-cross.

## When you remove a feature

1. Remove the CSP entry in `tauri.conf.json` (and `devCsp` if mirrored).
2. Remove the row from this doc.
3. If the entry is shared by multiple features, add a comment column noting the remaining consumers.

## Related

- [`docs/devops/review-security-invisible-apps.md`](../devops/review-security-invisible-apps.md) — broader app-security review of the CSP plus IPC auth, P2P feature gating, etc.
- [`Architect/decisions/2026-05-10-build-pipeline-quick-wins`](../../Obsidian/...) (vault) — the architect run that introduced this doc.
