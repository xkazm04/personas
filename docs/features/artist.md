# Artist

> A local-first creative workspace for AI-assisted image and 3D asset generation, a navigable gallery of everything that has been produced, and a real video timeline editor that stitches it all into a finished MP4 — all from one Personas plugin.

The plugin lives at `src/features/plugins/artist/` and is exposed through the **Plugins → Artist** entry in the sidebar. The Rust surface lives at `src-tauri/src/commands/artist/` (Blender MCP + asset DB in `mod.rs`, FFmpeg detection/probe/export/one-shots in `ffmpeg.rs`).

---

## What it does

Artist is three complementary surfaces stacked behind one icon, and all three write to (or read from) the same managed folder on disk:

| Surface | Direction | Backing storage |
|---|---|---|
| **Creative Studio** (Blender MCP + Leonardo + Gemini via Claude CLI) | App → disk | Outputs dropped into the Artist folder; sessions replayed from `creativeSessions[]` on the artist slice |
| **Gallery** (2D masonry + 3D model viewer) | Disk → App | SQLite `artist_assets` table indexed by absolute path, tagged + searchable |
| **Media Studio** (timeline video editor + FFmpeg export) | App → disk | In-memory `Composition` graph compiled to a filter-graph and rendered through FFmpeg |

The three surfaces share one connective tissue: the **Artist folder** (default `~/Artist/`, configurable). Generation from Creative Studio lands files there; the Gallery scanner imports them into SQLite; the Media Studio can drop them onto the timeline with one click. Nothing leaves the machine — every generation call is mediated by the user's own creative-tool credentials in the Vault.

---

## User flow

The plugin is organised as three tabs: **Creative Studio**, **Gallery**, **Media Studio**. Tab selection is persisted on the artist slice so the user lands back where they left off.

### 1. Creative Studio — generate with connected tools

1. Open **Plugins → Artist → Creative Studio**.
2. Click the **Environment Status** header to expand the diagnostics card. The panel is **collapsed by default and lazy-checks** — the `pip show blender-mcp` subprocess only fires when the user actually opens the card, so the tab itself is snappy even on slow hosts. Status is cached on the artist slice for 5 minutes.
3. The card shows:
   - **Blender** — detected install + version, or a hint to install from blender.org.
   - **Blender MCP** — installed/not; one-click **Install** runs `pip install blender-mcp` via the backend.
   - **Image Generation Tools** — per-connector chips for Leonardo AI and Gemini AI, pulled live from the Vault. Each chip shows *Connected & healthy* / *Connected (not verified)* / *Not connected*, with a **Connect** button that deep-links the sidebar to the Vault.
4. Below the env card a **History** drawer lists past creative sessions (persisted across app restarts, capped at 25 sessions × 300 lines). Each entry shows a status dot, the original prompt, relative time, and the tools used. Hover reveals **Replay** (reloads the archived output back into the live panel) and **Delete**.
5. The **Creative Session** card is the working surface. Write a prompt, press Enter. The prompt plus the currently connected tools are handed to Claude CLI (the real runtime), which orchestrates Blender MCP and/or the image connectors. Output streams back line-by-line via the `artist-session-output` Tauri event and lands both in the live panel and in the session record. Square button cancels mid-stream; trash icon clears the live panel (does not touch history).
6. When a session completes, the plugin **auto-rescans the Artist folder** and imports any new assets into the Gallery, appending a `[System] Imported N new asset(s) to gallery.` line so the user sees the loop close.

> *Why a separate "Creative Studio" and not just a chat?* Because the creative loop is defined by which tools are wired up, not by model choice. The env panel is the UI that makes that state legible — you see at a glance whether the run you are about to dispatch can actually reach Blender or Leonardo, and you can fix it in-place without switching to Vault.

### 2. Gallery — the asset library

1. Open the **Gallery** tab. The toolbar lets you toggle **2D Images / 3D Models**, search file names + tags, sort by date/name/size, flip the sort direction, and trigger **Scan Folder**.
2. **Scan Folder** walks the configured Artist folder (and its `images/` + `models/` subfolders), calls `artist_scan_folder` to probe each file, and imports new rows into SQLite via `artist_import_asset`. Existing rows (matched by absolute `file_path`) are skipped. The scan toast is pluralized correctly: `Found N assets, imported M new.`
3. Assets render in a responsive grid (2–6 columns depending on viewport). Thumbnails are loaded via Tauri IPC (`artist_read_image_base64`) and **cached at module scope** (300-entry LRU + in-flight dedupe) so remounting the grid from a sort or search change is free — one IPC per file, not one per render.
4. Hovering any card reveals three actions:
   - **Delete** — removes the DB row; the file on disk is untouched.
   - **Edit Tags** — opens a themed chip editor (Enter/comma to add, Backspace to drop the last tag, Esc to close). Tags are stored as a comma-joined string on the asset row.
   - **Send to Media Studio** (2D only) — queues the asset on the artist slice and flips the active tab to Media Studio. See **Lifecycle** below.
5. Clicking a 2D asset opens a full-screen **lightbox** with left/right navigation, image counter, and keyboard shortcuts (`←` `→` cycle, `Esc` closes, click outside dismisses).
6. Clicking a 3D asset opens the **3D viewer modal** — a real `@react-three/fiber` canvas with OrbitControls, auto-rotate toggle, wireframe toggle, and three lighting presets (`studio`, `outdoor`, `sunset`-backed; `soft` = `apartment`). The viewer code is **lazy-loaded** — the ~1MB three.js chunk is only fetched when the user actually opens a `.glb` / `.gltf` for the first time. Unsupported extensions (`.fbx`, `.obj`, `.blend`, `.stl`…) render a polite "preview not available" fallback that recommends exporting as glTF.

### 3. Media Studio — timeline compositor

1. Open the **Media Studio** tab. A top banner probes for **FFmpeg** using `requestIdleCallback` so mounting the tab never blocks on `ffmpeg -version`. No FFmpeg = a friendly install banner with OS-specific commands and a **Check again** button.
2. With FFmpeg present and no clips yet, the empty state offers four CTAs (Video / Audio / Image / Text Beat) and tells you that drag-and-drop also works anywhere in the tab.
3. Once the first clip is added, the layout becomes a three-pane workbench:
   - **Preview pane** (top-left, 62% width) — a live 16:9 video surface that honours speed, fades, transitions, strip-audio, loudnorm preview gain, and text/image overlays at the same relative position they will have at export time. The playback clock is an *imperative* engine (not React state) that notifies subscribers via rAF — touching 60-fps state would re-render the tree on every tick.
   - **Inspector pane** (top-right, 38% width) — context-sensitive. With nothing selected it shows the output settings (name, resolution preset grid, framerate, background color). With a clip selected it shows the clip's timing, trim, volume/speed, fade in/out, transition picker (video only), and clip actions (split at playhead, extract audio, save current frame as thumbnail, trim to a new file, toggle strip-audio, toggle EBU R128 loudness normalization).
   - **Timeline panel** (bottom, 260px tall) — four lanes (Text, Image, Video, Audio), each collapsible via its color-coded rail. The ruler is clickable to seek and the triangular playhead handle is draggable. `Ctrl+wheel` zooms; plain wheel scrolls. Zoom-to-fit, pixel-per-second readout, and **undo / redo** buttons live in the toolbar.
4. **Audio lanes render real waveforms** decoded in-browser via Web Audio API — integrated LUFS is measured once per clip on normalize-toggle and driven through a Web Audio GainNode so the preview matches what the export will render.
5. **Video lanes render real frame thumbnails** — six evenly-spaced frames grabbed via an offscreen `<video>` + canvas and cached module-scope. Failures fall back to a filmstrip pattern.
6. **Transitions between video clips** (cut / crossfade / fade-to-black) show as a round icon between clip edges in the lane and are folded into the clip's effective fade values so preview parity holds with the FFmpeg filter graph.
7. **Export** lives in its own footer strip — picks an output path via the native file dialog, streams progress back through the `media-export-progress` event, and reports success/failure in-line. The FFmpeg command is assembled by the Rust side using the clip graph as input, so every effect you see in the preview is rebuilt server-side with the same rules.

### Lifecycle, end-to-end

```
┌────────────────┐  prompt   ┌────────────────┐   scan    ┌──────────────┐
│ Creative       │ ────────► │    Artist      │ ────────► │   Gallery    │
│ Studio         │           │    folder      │           │   (SQLite)   │
│ (Claude CLI)   │           │ (local disk)   │           │              │
└────────────────┘           └────────────────┘           └──────┬───────┘
                                                                 │
                                                                 │ "Send to
                                                                 │  Media Studio"
                                                                 ▼
┌────────────────┐  export   ┌────────────────┐   drop    ┌──────────────┐
│ MP4 on disk    │ ◄──────── │  Media Studio  │ ◄──────── │   Pending    │
│ (FFmpeg)       │           │  timeline      │           │   asset      │
└────────────────┘           └────────────────┘           │   queue      │
                                                          └──────────────┘
```

Each stage is independent — you can use the Gallery as a standalone asset-manager for files you generated elsewhere, the Creative Studio to iterate on prompts without ever opening Media Studio, or drop raw footage directly into Media Studio without touching the Gallery.

---

## Strongest use case (speculation)

> **A vendor-neutral personal studio for AI-assisted short-form content — the "local Descript + Midjourney + Blender, without the subscription or the upload."**

Today creators who want to combine AI imagery, 3D renders, voice-overs, and a video timeline need to juggle three SaaS products (an image generator, a 3D tool, a web-based editor), each of which insists on uploading your footage to its servers. Every extra hop costs time, money, and control; every rendered short ends up in someone else's cloud.

Artist's killer flow is:

1. A prompt in **Creative Studio** lands a Leonardo image and a matching Blender render directly into `~/Artist/`.
2. The Gallery picks them up automatically, tags them, thumbnails them.
3. A voice-over the user recorded in any tool is dragged onto the Media Studio timeline alongside those two assets, beats are added over the important lines, a title card crossfades into the first shot, and the whole thing exports to MP4 with loudness-normalized audio — **without a single upload**.

The combination is hard to replicate from outside: you need a *desktop app* to run Blender locally and read files off disk (a browser sandbox can't), you need *the user's own connector credentials* so they get raw API costs instead of markup, and you need a *real NLE-style timeline* — not a thin "storyboard" — so the work is durable. Artist occupies the quiet niche where all three constraints meet: local-first, bring-your-own-key, real editor.

---

## Five development directions

### 1. Full MCP orchestration loop — let Claude drive the Media Studio, not just the prompt

Today a creative session hands off to Claude CLI, which can call Blender MCP and image connectors, but it has *no ability to reach back into the Media Studio*. The natural next move:

- Expose the `Composition` graph as MCP tools — `timeline.addItem`, `timeline.updateItem`, `timeline.export`.
- Let an agent write a prompt like *"assemble yesterday's renders into a 30-second teaser with crossfade transitions and a title card"* and actually get a timeline.
- Add a "Dry run" mode that shows the proposed edits in a diff panel before applying — undo/redo is already there to catch anything the user dislikes.

This closes the loop most AI video products miss: the agent becomes a *co-editor*, not just a *generator*.

### 2. Session → Storyboard → Timeline as a first-class mode

The "Send to Media Studio" handoff is today a one-click drop into the image lane. Turn it into a proper mode:

- A **Storyboard view** inside Creative Studio that lays out generated images chronologically with per-shot prompts and durations.
- "Send storyboard to Media Studio" pushes the entire sequence with pre-filled text beats (from the prompts), crossfade transitions, and matching durations.
- Round-trip: selecting an ImageItem on the timeline could open the originating session so the user can re-roll a frame without context-switching.

This is the single change that makes Artist feel like *one tool* instead of three siblings sharing a sidebar tab.

### 3. Audio-first features — voice capture, music library, ducking

Audio is currently the weakest surface (drag-in only, one lane, no mixing). The high-leverage adds:

- **Voice capture** button in the inspector that records through the system mic straight into the Artist folder and auto-adds the clip to the audio lane.
- **Music library** — a curated set of royalty-free tracks bundled with the app (or streamed from a hosted index) searchable by mood/length.
- **Ducking** — when a narration clip is active, automatically attenuate music lanes under it. FFmpeg's `sidechaincompress` filter is a natural backend fit.
- Multiple audio lanes with per-lane solo / mute.

This is where users shift from "I can assemble a video" to "I can produce a narrated short in one sitting."

### 4. Project save/load + templates

The Media Studio composition is entirely in-memory — closing the tab loses the whole timeline. Fix that:

- Persist compositions to `~/Artist/projects/<name>.json` (or a new SQLite table) with open-recent and duplicate.
- Ship **templates**: "Vertical social clip 9:16 with music bed + captions", "16:9 product demo with intro title + outro CTA", "Square storyboard with narration". Each template is a composition with placeholder items the user swaps in.
- Export presets (YouTube 1080p30, TikTok 1080p60, square social, etc.) that pin resolution + fps + bitrate.

Projects + templates are what turns a proof-of-concept editor into a daily-driver one.

### 5. Batch rendering and a render queue

Right now export is modal — you pick one output and wait. A render queue unlocks batch workflows:

- Queue N exports, each with its own preset / resolution / output path.
- Background worker processes the queue, emits the existing `media-export-progress` events per job.
- The queue panel surfaces ETA, errors, and a **Cancel / Retry** per row.
- Pair with templates: "Render this composition to 9:16 + 16:9 + square" becomes one click.

Essential for creators publishing the same content to multiple platforms, and an easy add because the FFmpeg backend is already a background task.

---

## Asset folder conventions

The Artist folder is structured as:

```
~/Artist/                                 (default; user-configurable)
├── images/                               scanned as assetType = "2d"
└── models/                               scanned as assetType = "3d"
```

`artist_ensure_folders` creates the tree on first use; `artist_scan_folder` walks both subtrees and returns probed `ArtistAsset` rows ready to insert. Imports dedupe by absolute `file_path`, so rescanning after a generation only inserts genuinely new files.

---

## Reference: backend commands

| Command | Purpose |
|---|---|
| `artist_check_blender` | Detect Blender install, blender-mcp package, and whether the MCP server is running |
| `artist_install_blender_mcp` | `pip install blender-mcp` (2-minute timeout) |
| `artist_run_creative_session` | Dispatch a Claude CLI session with configured tools; streams output via `artist-session-output` |
| `artist_cancel_creative_session` | Kill a running session by job id |
| `artist_scan_folder` / `artist_import_asset` | Walk the Artist folder and insert new rows into the asset table |
| `artist_list_assets` / `artist_delete_asset` / `artist_update_tags` | Asset CRUD for the Gallery |
| `artist_get_default_folder` / `artist_ensure_folders` | Folder bootstrap and default resolution |
| `artist_read_image_base64` | Read a local image as a base64 data URL for rendering through the webview |
| `artist_check_ffmpeg` | Locate the `ffmpeg` binary and return its version string |
| `artist_probe_media` | `ffprobe`-backed metadata for any video/audio/image file |
| `artist_export_composition` | Compile a `Composition` JSON to an FFmpeg filter graph and render to MP4; streams `media-export-progress` |
| `artist_cancel_export` | Abort an in-flight export |
| `artist_extract_audio` | One-shot extract an audio track to m4a/mp3/wav |
| `artist_save_thumbnail` | Grab a single frame from a video at time T |
| `artist_measure_loudness` | Two-pass loudnorm dry-run; used to compute true linear preview gain |
| `artist_trim_file` | Stream-copy trim a media file between `[start, end]` into a new output |

Tauri events:

| Event | Payload | Emitter |
|---|---|---|
| `artist-session-output` | `{ job_id, line }` | Creative session stdout |
| `artist-session-status` | `{ job_id, status, error? }` | Session lifecycle |
| `artist-session-complete` | `{ session_id, output_lines }` | Session finished — triggers auto-scan |
| `media-export-progress` | `{ job_id, progress, time }` | FFmpeg progress parser |
| `media-export-status` | `{ job_id, status, error? }` | Export lifecycle |
| `media-export-complete` | `{ job_id, output_path }` | Export finished |

---

## Reference: frontend modules

```
src/features/plugins/artist/
├── ArtistPage.tsx                        # three-tab host
├── types.ts                              # GalleryMode type
├── utils/format.ts                       # shared time / file-size formatters
├── hooks/
│   ├── useArtistAssets.ts                # gallery CRUD + scan-and-import
│   ├── useBlenderMcp.ts                  # lazy env check, cached on artist slice
│   ├── useCreativeConnectors.ts          # Leonardo / Gemini Vault status
│   ├── useCreativeSession.ts             # Claude CLI session + history recording
│   ├── useLocalImage.ts                  # base64 thumbnail loader with LRU cache
│   └── useModelViewer.ts                 # wireframe / autoRotate / lighting state
├── sub_blender/
│   ├── CreativeStudioPanel.tsx           # env card + session chat
│   └── CreativeSessionHistory.tsx        # persisted session list with replay
├── sub_gallery/
│   ├── GalleryPage.tsx                   # toolbar + mode switcher
│   ├── Gallery2D.tsx                     # masonry + lightbox with keyboard nav
│   ├── Gallery3D.tsx                     # grid + 3D modal
│   ├── AssetCard.tsx                     # hover actions + Send-to-Media-Studio
│   ├── TagEditorModal.tsx                # themed chip editor
│   └── ThreeViewer.tsx                   # lazy-loaded react-three-fiber viewer
└── sub_media_studio/
    ├── MediaStudioPage.tsx               # three-pane workbench host
    ├── types.ts                          # Composition / timeline item types
    ├── constants.ts                      # resolution defaults, zoom limits
    ├── CompositionPreview.tsx            # live 16:9 preview surface
    ├── TimelinePanel.tsx                 # ruler, lanes, playhead, undo/redo toolbar
    ├── TimelineRuler.tsx                 # tick + label rendering
    ├── TimelineClip.tsx                  # shared drag / trim clip wrapper
    ├── TextLane.tsx / ImageLane.tsx / VideoLane.tsx / AudioLane.tsx
    ├── InspectorPanel.tsx                # output settings + per-clip editor
    ├── TransitionPicker.tsx              # cut / crossfade / fade-to-black
    ├── PlaybackControls.tsx              # play / pause / stop / loop
    ├── FfmpegStatusBanner.tsx            # install banner
    ├── ClipContextMenu.tsx               # right-click menu
    ├── ExportPanel.tsx                   # MP4 export footer
    └── hooks/
        ├── useMediaStudio.ts             # composition + undo/redo history
        ├── useTimelinePlayback.ts        # imperative rAF playback engine
        ├── useTimelineKeyboard.ts        # space / arrows / Ctrl+Z / Delete …
        ├── useMediaFilePicker.ts         # native file dialogs + probe
        ├── useFfmpegDetect.ts            # idle-scheduled ffmpeg detection
        ├── useMediaExport.ts             # export job lifecycle
        ├── useAudioWaveform.ts           # Web Audio peak extraction (LRU cached)
        └── useVideoThumbnails.ts         # offscreen-video frame grabbing (LRU cached)
```

Backend:

```
src-tauri/src/commands/artist/
├── mod.rs                                # Blender MCP, assets, creative session
└── ffmpeg.rs                             # detection, probe, export, one-shots
```

State lives in `src/stores/slices/system/artistSlice.ts` (tab, folder, gallery mode, cached Blender status, creative sessions, pending Media-Studio asset queue, connector info). Persisted subset (artist tab, artist folder, creative session history) partialized in `src/stores/systemStore.ts`. All copy lives under `t.plugins.artist.*` and `t.media_studio.*` in `src/i18n/en.ts`.
