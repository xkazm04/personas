# Golden path — Tauri permissions and the Content-Security-Policy

> Situation node: `platform-delivery/packaging-and-release/tauri-permissions-and-csp` ·
> [situation spine](../situation-spine.md) · recurrence 4 · risk **HIGH** · sides **server**
> (refuted — §12.1) · convergence **mixed** (refuted — §12.2) · dimensions: **security · function ·
> code-quality · cost**
> Composed 2026-08-17 against `master` @ `9fdede67c`.
>
> **Sweep.** All **5** Tauri configuration files under `src-tauri/` (four `tauri*.conf.json` plus the
> orphan `.tauri-scraper-dev.conf.json`), both `capabilities/*.json`, the **two materialized merged
> configs** left on disk by a past `tauri android` run, `src-tauri/Cargo.toml`'s `[features]` table,
> the built ACL manifest `src-tauri/gen/schemas/acl-manifests.json` (15 namespaces, 193 distinct
> commands), `scripts/check-tauri-configs.mjs`, `scripts/check-csp-hosts.mjs`,
> `scripts/run-codegen.mjs`, `src-tauri/src/ipc_auth.rs` (1,215 lines, read in full),
> `src-tauri/src/lib.rs`'s `generate_handler!` block, and all **963** non-generated `.rs` files under
> `src-tauri/` plus all **4,829** `.ts`/`.tsx` files under `src/`. The vendored **tauri 2.11.2** /
> **tauri-utils 2.9.2** crates were read where the semantics are the finding.
>
> **Measured by executing, not reading.**
> 1. **The capability files were resolved into their actual command sets** by walking
>    `gen/schemas/acl-manifests.json` transitively — permission sets, `default_permission`, and
>    `commands.allow` / `commands.deny`. That is what produces the **120 / 112 / 193** numbers below,
>    and the per-entry *marginal* contribution that shows **6 of 15 declared entries grant nothing**.
> 2. **The build-script outputs already on disk decided the dev-vs-release question**, rather than
>    inference: `src-tauri/target/debug/build/tauri-*/output` — **10 files, every one
>    `cargo:dev=true`**; `src-tauri/target/release/build/tauri-c7b8d57c900b0b21/output` —
>    **`cargo:dev=false`**. Combined with `PROXY_DEV_SERVER = cfg!(all(dev, mobile))`
>    (`tauri-2.11.2/src/manager/webview.rs:43`) this settles §0.4.
> 3. **The 144 MB release binary was probed for the CSP strings it embeds** — `stream-test.localhost`
>    present, `s.ytimg.com` present, `api.crossref.org` **absent** (added after that build),
>    `shellexecute` absent. Both policies ship in the binary; one is selected at runtime.
> 4. **`src-tauri/gen/android/app/src/main/assets/tauri.conf.json`** — the merged Android config a
>    past `tauri android` run actually produced — was read as the empirical proof of the platform
>    merge semantics, instead of taking `json_patch::merge` on faith.
> 5. The **operator's live app data directory** was listed read-only to establish what the asset
>    protocol's declared scope contains. **No file inside it was opened, and no secret value appears
>    anywhere below** — filenames and byte sizes only, both of which are already public in this
>    repo's own source.
> 6. The §9 rule and its positive control were built, run through the real runner in a private
>    scratch registry (`rules-tpc-tauri-permissions-csp-probe.json`), **fault-injected ten ways
>    including one real violation appended to `capabilities/default.json` and reverted clean**, then
>    re-extracted from this finished document and re-run: identical.
>
> **No build was run, no `cargo` invoked, and the app was not launched.** Nothing in this document was
> applied. **The Deviations section is a fix backlog.**
>
> **Seams.** [`second-transport-exposure`](./second-transport-exposure.md) and
> [`inbound-endpoint-surface`](./inbound-endpoint-surface.md) own the **HTTP** doors — who may address
> them and what the route table is. This path owns the **IPC** door and the **renderer's** capability
> envelope: what `tauri.conf.json` and `capabilities/*.json` grant, to which window, and what a script
> executing inside the WebView can therefore reach.
> [`least-privilege-scope-grant`](./least-privilege-scope-grant.md) owns the app's *own* scope
> vocabulary (`personas:read`, `proxy`); this path owns **Tauri's**.
> [`compile-time-env-embedding`](./compile-time-env-embedding.md) owns values baked at build time;
> this path owns the *policy* baked at build time. [`external-url-opening`](./external-url-opening.md)
> owns `open::that`. Where a finding is theirs I confirm it and cite it; I do not re-derive it.

---

## 0. The permission surface, before anything else

**Right now, on this checkout: two capability files grant 120 of Tauri's 193 plugin commands to one
window. Tauri's ACL gates none of this application's own 1,585 IPC commands, because the app declares
no ACL manifest. 1,356 of those 1,585 require no credential of any kind, and the token that guards
the other 229 is published to the page as `window.__IPC_TOKEN`. The renderer loads a third-party
script from `youtube.com` into its top-level document. `withGlobalTauri` is on, for a window that was
deleted three months ago. And the one config file in the repository carrying a banned CSP token is
the one config file the gate that bans it does not read.**

### 0.1 — Every capability, every permission, and the window it applies to

Two files. Resolved against the built ACL manifest, not read off the page:

| File | identifier | `windows` | `webviews` | `platforms` | `remote` | entries | **commands allowed** |
|---|---|---|---|---|---|---:|---:|
| `src-tauri/capabilities/default.json` | `default` | **`["main"]`** | — | linux, macOS, windows | **none** | 15 | **120** |
| `src-tauri/capabilities/mobile.json` | `mobile` | **absent → every window** | — | android, iOS | **none** | 9 | **112** |

The desktop grant, by namespace — 120 commands, deny-subtracted, every one enumerated:

| Namespace | n | Commands |
|---|---:|---|
| `core:window` | 32 | `activity_name, available_monitors, close, current_monitor, cursor_position, get_all_windows, inner_position, inner_size, internal_toggle_maximize, is_always_on_top, is_closable, is_decorated, is_enabled, is_focused, is_fullscreen, is_maximizable, is_maximized, is_minimizable, is_minimized, is_resizable, is_visible, minimize, monitor_from_point, outer_position, outer_size, primary_monitor, scale_factor, scene_identifier, start_dragging, theme, title, toggle_maximize` |
| `core:menu` | 22 | `append, create_default, get, insert, is_checked, is_enabled, items, new, popup, prepend, remove, remove_at, set_accelerator, set_as_app_menu, set_as_help_menu_for_nsapp, set_as_window_menu, set_as_windows_menu_for_nsapp, set_checked, set_enabled, set_icon, set_text, text` |
| `notification` | 16 | `batch, cancel, check_permissions, create_channel, delete_channel, get_active, get_pending, is_permission_granted, list_channels, notify, permission_state, register_action_types, register_listener, remove_active, request_permission, show` |
| `core:tray` | 12 | `get_by_id, new, remove_by_id, set_icon, set_icon_as_template, set_icon_with_as_template, set_menu, set_show_menu_on_left_click, set_temp_dir_path, set_title, set_tooltip, set_visible` |
| `core:app` | 8 | `bundle_type, identifier, name, register_listener, remove_listener, supports_multiple_windows, tauri_version, version` |
| `core:path` | 8 | `basename, dirname, extname, is_absolute, join, normalize, resolve, resolve_directory` |
| `core:image` | 5 | `from_bytes, **from_path**, new, rgba, size` |
| `core:event` | 4 | `emit, emit_to, listen, unlisten` |
| `core:webview` | 4 | `get_all_webviews, **internal_toggle_devtools**, webview_position, webview_size` |
| `updater` | 4 | `check, download, **download_and_install**, install` |
| `dialog` | 3 | `message, open, save` |
| `core:resources` | 1 | `close` |
| `deep-link` | 1 | `get_current` |

Mobile is the same set minus **8**: `core:window|{close, minimize, start_dragging, toggle_maximize}`
and all four `updater` commands. **Nothing is granted on mobile that is not granted on desktop.**

**Six of the fifteen desktop entries grant nothing.** Marginal contribution, measured by resolving
each entry in declaration order and counting what it adds:

| Entry | grants | **new** |
|---|---:|---:|
| `core:default` | 92 | **92** |
| `core:app:default` | 8 | **0** — already inside `core:default` |
| `core:event:default` | 4 | **0** — already inside `core:default` |
| `notification:default` | 16 | **16** |
| `notification:allow-is-permission-granted` | 1 | **0** |
| `notification:allow-request-permission` | 1 | **0** |
| `notification:allow-notify` | 1 | **0** |
| `deep-link:default` | 1 | 1 |
| `dialog:default` | 3 | 3 |
| `updater:default` | 4 | 4 |
| `core:window:allow-minimize` | 1 | 1 |
| `core:window:allow-toggle-maximize` | 1 | 1 |
| `core:window:allow-close` | 1 | 1 |
| `core:window:allow-is-maximized` | 1 | **0** — already inside `core:default` |
| `core:window:allow-start-dragging` | 1 | 1 |

**`core:default` is 92 of the 120.** The five hand-picked `core:window:allow-*` entries at the bottom
are the shape of someone practising least privilege — *after* the first line already opened
`core:window`'s 28-command default. Three of those five, plus three `notification:allow-*`, plus
`core:app:default` and `core:event:default`, are dead text. **40% of the declared vocabulary in this
file has no effect on what the app can do.** `mobile.json` is the same shape and worse in proportion:
**5 of its 9 entries contribute 0** (`core:app:default`, `core:event:default`, and all three
`notification:allow-*`). Across both files, **7 of the 11 named `*:allow-*` grants are already covered
by a `*:default` entry above them** — which is the measurement §9's positive control exists to make.

**One registered plugin has zero granted commands.** `window-state` is registered at `lib.rs:577`
(`tauri_plugin_window_state::Builder::new().build()`, behind the `desktop` feature) and offers 3
commands in the manifest. **No capability names it.** Its JS surface is unreachable; its Rust
save/restore side works, which is why nobody noticed. That is one *whole namespace* granted in Rust
and withheld in the ACL, and the inverse case — granted in the ACL and unused — is §7.C.

**Neither capability declares `remote`, and that is the one control here doing real work.** The app
creates a second webview labelled `oauth` at `commands/infrastructure/auth.rs:444` and `:571`, with
`tauri::WebviewUrl::External(oauth_url)` — Google's and Microsoft's live consent pages, running inside
this process. `capabilities/default.json` scopes to `windows: ["main"]`, and Tauri refuses IPC from a
non-local origin outright:

```rust
// tauri-2.11.2/src/webview/mod.rs:1818-1852
// Check ACL on plugin commands, when the app defined its ACL manifest,
// or when the request comes from a non-local (remote) origin.  This
// ensures remote content can never reach custom commands unless an
// explicit `remote` capability has been configured for them.
if (plugin_command.is_some() || has_app_acl_manifest || !is_local) && invoke.acl.is_none() { … reject }
```

So the remote consent page can invoke nothing. **This is correct, and this repo did not write it** —
it is Tauri's default, and it holds because nobody added a `remote` clause. Do not add one.

### 0.2 — The 1,585 commands Tauri's ACL does not gate, and the token that is on `window`

The same three-condition guard is the whole story from the other direction. `has_app_acl_manifest` is
`RuntimeAuthority::has_app_manifest()` — true only when the app crate ships its own
`src-tauri/permissions/` directory. **It does not exist.** The built manifest confirms it: 15
namespaces, all of them `core:*` or a Tauri plugin, **no app namespace**.

So for a **local** origin the guard reads `(false || false || false)` and every app-defined command
dispatches without consulting the ACL at all:

| | Count |
|---|---:|
| `#[tauri::command]` attributes in 963 `.rs` files | **1,661** |
| …distinct command function names | **1,658** |
| …registered in `generate_handler!` (`lib.rs:1823`) | **1,585** |
| …defined but never registered | **73** |
| **…covered by any Tauri capability** | **0** |

The app built its own boundary instead, in `src/ipc_auth.rs` — a three-tier scheme keyed on
**string command names**:

| Tier | Source | Registered commands in it |
|---|---|---:|
| Cloud | `CLOUD_COMMANDS` (`ipc_auth.rs:763`) | 50 declared |
| Privileged | `PRIVILEGED_COMMANDS` (`:117`) | 184 declared |
| **Union, intersected with `generate_handler!`** | | **229** |
| **Public — no token, no scope, no capability** | | **1,356 = 85.6%** |

Five names are listed but never registered — `github_create_patch_release`, `openapi_parse_from_url`,
`openapi_parse_from_content`, `openapi_generate_connector`, `create_execution` — and the file says so
for three of them, deliberately, so the gate is armed before the command is wired. That is good
practice and worth copying.

**And the token is on `window`.** `generate_ipc_auth_script` (`ipc_auth.rs:691`) is installed as a
`js_init_script` on a synthetic `ipc-auth` plugin (`lib.rs:590-594`), and its first act is:

```js
try { window.__IPC_TOKEN = _t; } catch(_e) {}          // ipc_auth.rs:703
```

The docstring explains why (`:684-690`): the `__TAURI_INTERNALS__.invoke` monkey-patch races the
first privileged call on Windows WebView2, so the frontend wrapper needs to read the token and attach
the header itself. The reasoning is sound and the fallback is real. **The consequence is that
`PRIVILEGED_COMMANDS` provides exactly zero resistance to a script executing in the renderer**, which
is the only place an IPC request can originate. It is a defence against a *timing* problem, not
against an *attacker* problem, and §0.6 is what happens when you read it as the latter.

Tauri's own `__TAURI_INVOKE_KEY__` check (`webview/mod.rs:1748-1762`) sits above it and has the same
property: it is injected into the page, so any script in the page has it.

### 0.3 — Seven CSP strings on disk, four distinct policies, three enforcement clocks

| # | Where | Enforced when | Read by a gate? |
|---|---|---|---|
| 1 | `tauri.conf.json` `app.security.csp` | **packaged desktop build** (`cfg(dev)` false) | `check-tauri-configs` ✅ · `check-csp-hosts` ✅ (connect-src only) |
| 2 | `tauri.conf.json` `app.security.devCsp` | **`tauri android dev` only** — see §0.4 | `check-csp-hosts` ✅ (connect-src only) · `check-tauri-configs` ❌ |
| 3 | `tauri.android.conf.json` `app.security.csp` | packaged Android build | **❌ neither** |
| 4–5 | `gen/android/app/src/main/assets/tauri.conf.json` — merged `csp` + `devCsp` | shipped into the APK's assets | ❌ neither |
| 6–7 | `gen/android/app/build/intermediates/…/tauri.conf.json` — the same pair again | build intermediate | ❌ neither |

Full directive diff of the three **authored** policies. 13 directives; every difference is listed.

| Directive | `csp` (packaged desktop) | `devCsp` | android `csp` |
|---|---|---|---|
| `default-src` | `'self'` | `'self' **http://localhost:***` | `'self'` |
| `script-src` | `'self' **https://www.youtube.com https://s.ytimg.com**` | `'self' **http://localhost:*** https://www.youtube.com https://s.ytimg.com` | `'self' **'unsafe-eval'**` |
| `style-src` | `'self' 'unsafe-inline'` | `'self' 'unsafe-inline' http://localhost:*` | `'self' 'unsafe-inline'` |
| `img-src` | `'self' asset: http(s)://asset.localhost cdn.simpleicons.org **lh3.googleusercontent.com** i.ytimg.com yt3.ggpht.com data: blob:` | same but **`*.googleusercontent.com`** + `http://localhost:*` | `'self' cdn.simpleicons.org data:` — **no `asset:`** |
| `connect-src` | `'self' **asset: http(s)://asset.localhost** raw.githubusercontent.com gist.githubusercontent.com github.com `*`.ingest.sentry.io export.arxiv.org api.crossref.org `*`.somafm.com www.youtube.com `*`.googlevideo.com` | + `http://stream-test.localhost stream-test: **http://localhost:\* ws://localhost:\***` | `'self' raw.githubusercontent.com gist.githubusercontent.com *.ingest.sentry.io` — **no `asset:`, no loopback** |
| `media-src` | `'self' asset: http(s)://asset.localhost *.somafm.com *.googlevideo.com blob:` | + `http://localhost:*` | `'self'` |
| `font-src` | `'self'` | `'self' data: http://localhost:*` | `'self'` |
| `frame-src` | `www.youtube.com www.youtube-nocookie.com` | same | **`'none'`** |
| `object-src` · `base-uri` · `form-action` · `worker-src` · `manifest-src` | `'none'` / `'self'` ×4 | identical | identical |

**Answering the brief's question directly. The shipping desktop CSP allows two things the dev one does
not:**

1. **`img-src https://lh3.googleusercontent.com`** — the packaged policy is *narrower* here
   (`lh3.` only) while `devCsp` opens the whole `*.googleusercontent.com` wildcard. That is the
   correct direction and the only directive where it holds.
2. Nothing else. **In every other directive `devCsp` is a strict superset of `csp`**, adding
   `http://localhost:*` to five directives, `ws://localhost:*` and `stream-test:` to `connect-src`,
   and `data:` to `font-src`.

**And the packaged Android CSP allows the one thing neither desktop policy does: `'unsafe-eval'` in
`script-src`.** It is the single most consequential token in any of the three, it is in the only
config file `check-tauri-configs.mjs` does not open, and §0.7 is about that.

**On the 116 loopback routes.** The brief supposed that `connect-src http://localhost:*` makes all
116 HTTP routes on `:9420` / `:17400` / `:17320` reachable from the WebView. The **packaged**
`connect-src` contains **no loopback host at all** — the routes are unreachable by `fetch` from a
packaged build, which is a real and load-bearing control nobody has written down. `devCsp` does list
`http://localhost:*`, and CSP host matching is on the **literal host string**, so `http://localhost:17400/…`
would be permitted while `http://127.0.0.1:17400/…` — the spelling every one of this repo's own
address literals uses ([`inbound-endpoint-surface`](./inbound-endpoint-surface.md) §0.4) — would not.
Both spellings reach the same socket. **The policy discriminates on a name; the kernel discriminates
on an address; and the permissive spelling is the one that resolves.** But §0.4 makes the whole
question moot on desktop.

### 0.4 — `devCsp` is enforced on exactly one platform, and this repo does not ship it

`AppManager::csp()` picks the policy:

```rust
// tauri-2.11.2/src/manager/mod.rs:369-381
fn csp(&self) -> Option<Csp> {
  if !crate::is_dev() { self.config.app.security.csp.clone() }
  else { self.config.app.security.dev_csp.clone().or_else(|| …csp.clone()) }
}
```

The **only** callers that apply it are `AppManager::get_asset` (`:440-442`, via `set_csp` at `:53`)
and the isolation protocol. `get_asset` serves the `tauri://localhost` custom protocol. So the CSP is
attached to a response **this process serves**.

In `tauri dev` on desktop, this process serves nothing:

```rust
// tauri-2.11.2/src/manager/webview.rs:43
pub(crate) const PROXY_DEV_SERVER: bool = cfg!(all(dev, mobile));
```

```rust
// tauri-2.11.2/src/manager/webview.rs:444-449
WebviewUrl::App(path) => {
  let app_url = app_manager.get_app_url(…);            // = devUrl in dev
  let url = if PROXY_DEV_SERVER && is_local_network_url(&app_url) {
    Cow::Owned(Url::parse("tauri://localhost").unwrap())   // proxied -> get_asset -> set_csp
  } else { app_url };                                       // direct -> Vite serves it -> no CSP
```

`dev` is on and `mobile` is off, so `PROXY_DEV_SERVER` is **false**, the webview navigates straight to
`http://localhost:1420`, Vite answers, and no `Content-Security-Policy` header is ever produced.
`index.html` carries no `<meta http-equiv>` fallback and `vite.config.ts` sets no CSP header.

**Measured, not inferred** — the cfg is written into build-script output already on disk:

```
src-tauri/target/debug/build/tauri-*/output      10 files, all  cargo:dev=true   -> dev, desktop -> PROXY_DEV_SERVER=false
src-tauri/target/release/build/tauri-c7b8…/output              cargo:dev=false  -> packaged      -> csp applied via get_asset
```

**Consequences, in order of how much they matter:**

- **On `npm run tauri:dev` / `tauri:dev:lite` — what the operator runs every day — the WebView has no
  Content-Security-Policy at all.** Not a permissive one. None. Everything in §0.6 is reachable in
  dev with no policy to negotiate, and every daily-driver observation about "the CSP" is an
  observation about a string that is not in force.
- **`devCsp` is enforced on `tauri android dev` and nowhere else** — `cfg!(all(dev, mobile))`. And
  `tauri.android.conf.json` **does not declare a `devCsp`**, so that one live configuration inherits
  the *desktop* `devCsp` verbatim. The merged config on disk proves it: its `devCsp` is the desktop
  string of the day, complete with `ws://localhost:*` and `http://localhost:*`, inside a config whose
  own author wrote a deliberately tighter `csp` four lines above.
- **`check-csp-hosts.mjs` validates `devCsp` against every frontend `fetch` host** (`:139-141`), and
  fails the build if a host is missing from it. It is enforcing an allowlist that governs nothing on
  the platform it runs on. The check is not wrong — it is *aspirational*, and nothing says so.
- Both strings ship in the binary regardless: the release exe contains `stream-test.localhost`, a
  `devCsp`-only token. Embedding is not enforcement.

**The packaged policy, by contrast, is enforced — and is not the string in the config file.**
`set_csp` (`manager/mod.rs:53-107`) appends `'sha256-…'` for every inline `<script>` in the served
HTML, because `dangerousDisableAssetCspModification` is absent (default false — confirmed in the
merged Android config, which materializes it as `false`). `dist/index.html` has **2 inline script
blocks** and 3 external ones. So the enforced `script-src` is
`'self' https://www.youtube.com https://s.ytimg.com 'sha256-…' 'sha256-…'` — **two tokens no config
file states and no gate reads.**

### 0.5 — The asset protocol: no permission, one scope, and what is inside it

`assetProtocol` is **not** an ACL-gated capability. It appears in none of the manifest's 15
namespaces. Its entire access-control surface is 8 lines of `tauri.conf.json`:

```jsonc
"assetProtocol": {
  "enable": true,
  "scope": [
    "$APPDATA/**", "$APPLOCALDATA/**",
    "$DOCUMENT/Personas Media Studio/**",
    "$PICTURE/**", "$VIDEO/**", "$AUDIO/**", "$DOWNLOAD/**"
  ]
}
```

The handler (`tauri-2.11.2/src/protocol/asset.rs:29-120`) does three things: reject `..`
(`SafePathBuf::new`), check `scope.is_allowed(&path)` after canonicalisation, then `File::open` the
**absolute path from the URL** and stream it — with `Range` support (1 MB per range,
`MAX_LEN` at `:118`) and `Access-Control-Allow-Origin: <window origin>`. **No token, no capability, no
audit.** And `connect-src` in the packaged policy lists `asset: http://asset.localhost
https://asset.localhost`, so it is reachable by `fetch`, not merely by `<img src>`.

**Six of the seven scope entries are whole roots; one is narrowed to a subdirectory.**
`$DOCUMENT/Personas Media Studio/**` is the shape all seven should have had. `$PICTURE/**`,
`$VIDEO/**`, `$AUDIO/**` and `$DOWNLOAD/**` are the user's entire Pictures, Videos, Music and
Downloads trees.

`$APPDATA` resolves to `app_data_dir()` — `%APPDATA%\<identifier>`, not the whole roaming profile
(`tauri-2.11.2/src/path/mod.rs:332`). That bound is real and it is the reason this is a finding rather
than a catastrophe. It is still the wrong directory to publish. Listed read-only on this machine,
`C:\Users\…\AppData\Roaming\com.personas.desktop\` contains, by name and size only:

| Entry | Size | What it is |
|---|---:|---|
| `personas.db` | **347,054,080 B** | the application database — every credential row, execution, persona, 1,029 `external_api_keys` |
| `personas_data.db` | 17,502,208 B | the second store |
| `personas-cleanbak-2026-06-02….db` · `-06-03….db` | 44 MB · 30 MB | two full historical copies |
| **`master.key`** | **358 B** | the vault key file |
| `logs/` · `crash_logs/` · `backups/` · `drive/` · `models/` · `skill_scratchpads/` | — | including crash logs the repo's own code says may contain BYOM keys (`ipc_auth.rs:290-292`) |

`master.key` is a direct child of the scoped directory and `**` matches it. **The application's
credential-encryption key file and its entire database are inside a directory the renderer is
explicitly permitted to `fetch`, in the packaged build, with the packaged CSP fully enforced, with no
IPC command and no capability involved.** `convertFileSrc` — the API that produces those URLs — has
**16 call sites across 7 files**, every one of them the artist/media plugin or the custom-icon store,
and not one of them needs `$APPDATA`.

### 0.6 — What an XSS in the WebView reaches, and who can inject one

Composing §0.2, §0.5 and the CSP, a script executing in the top-level document of the `main` window
can:

1. **Invoke all 1,585 registered commands.** Tauri's ACL does not cover them (§0.2). For the 229 that
   want `x-ipc-token`, read `window.__IPC_TOKEN`. Among them: `create_credential`, `execute_db_query`,
   `mint_credential_handle`, `execute_persona` (spends the operator's Anthropic quota), `drive_delete`,
   `artist_export_composition` (spawns ffmpeg against caller-supplied absolute paths),
   `register_claude_desktop_mcp` (writes into Claude Desktop's global config),
   `export_credentials`.
2. **Read files** — `master.key`, `personas.db`, all of Pictures/Videos/Music/Downloads — via
   `fetch('http://asset.localhost/…')`, permitted by `connect-src` (§0.5).
3. **Exfiltrate** to `raw.githubusercontent.com`, `gist.githubusercontent.com`, `github.com`,
   `*.ingest.sentry.io`, `export.arxiv.org`, `api.crossref.org`, `*.somafm.com`, `www.youtube.com`,
   `*.googlevideo.com` — nine origins in `connect-src`, and a GET's path and query carry data fine.
4. **Use 120 plugin commands** — `dialog:open`/`save`, `core:image:from_path`,
   `core:webview:internal_toggle_devtools`, `updater:download_and_install` — through
   `window.__TAURI__`, which `withGlobalTauri: true` injects.

**The CSP is the only thing standing between the app and all of that**, which
`check-tauri-configs.mjs:104-116` already says in prose. Three measured facts about who can get past
it:

- **`script-src` admits `https://www.youtube.com` and `https://s.ytimg.com`, and the app uses it.**
  `src/features/plugins/radio/hooks/useYouTubePlayer.ts:61-65` does
  `document.createElement('script')` → `tag.src = 'https://www.youtube.com/iframe_api'` →
  `document.head.appendChild(tag)`. That is a **top-level document** script, not an iframe. YouTube's
  IFrame API therefore shares this application's JS realm and has items 1–4 above. `frame-src
  www.youtube.com` is the *safe* half of the same feature — an iframe is a separate origin and can
  reach none of it. **The script tag is the half that matters and it is the one nobody separated.**
- **`withGlobalTauri: true` has zero readers in shipped code.** `window.__TAURI__` appears **0 times
  in 4,829 `src/` files** and 0 times in `index.html` (whose own global error handler uses
  `window.__TAURI_INTERNALS__`, which exists regardless). Its four uses tree-wide are dev scripts
  driving the app through the test-automation `/eval` route. It was added by commit `079cf2604`
  (2026-05-09, *"radio(mvp): hidden YouTube IFrame Player"*) — the same commit that introduced the
  YouTube script — for a **separate hidden `WebviewWindow` labelled `radio`** described in its own
  message. **That window no longer exists**; the player moved into the main document. The flag stayed.
- **`freezePrototype: false`** (Tauri's default) in both desktop and Android, and
  `security.pattern: {"use":"brownfield"}` — the `isolation` pattern is off and `isolation` is not in
  `tauri`'s feature list (`Cargo.toml:110`). There is no layer between the page and the IPC.

### 0.7 — What `npm run check:tauri-configs` asserts, and what it does not

`scripts/check-tauri-configs.mjs` is a good gate. Its author knew exactly what was at stake and wrote
it down (`:104-137`) — including that a first version substring-matched `'unsafe-inline'` and failed
the clean tree on `style-src`, and that the fix was to parse directives. It asserts:

1. every file parses as JSON;
2. the two overlays' `$schema` equals the canonical's;
3. the overlays set only keys in `ALLOWED_OVERLAY_KEYS` (`build.features`, `bundle.targets`);
4. every `build.features` entry exists in `Cargo.toml`'s `[features]`;
5. `app.security.csp` is present in the canonical config and non-null;
6. **no `'unsafe-inline'` / `'unsafe-eval'` inside `script-src`, `script-src-elem`, `script-src-attr`
   or `default-src`** — the whole point;
7. `script-src` or `default-src` is declared at all.

It does not assert:

| Not asserted | Measured consequence |
|---|---|
| **It never opens `tauri.android.conf.json`.** `CANONICAL` and `OVERLAYS` are three hardcoded filenames (`:17-18`). | The **only** `BANNED_CSP_TOKENS` hit in the entire repository — `'unsafe-eval'` in `tauri.android.conf.json`'s `script-src` — is invisible to the assertion written to catch it. Run the same `checkCsp` over that file and it fires immediately. |
| **It never opens `.tauri-scraper-dev.conf.json`.** | A fifth, git-tracked Tauri config that enables `test-automation` — the 46-route unauthenticated HTTP bridge — and `scraper`. It has no `$schema` (assertion 2 would flag it) and is referenced by **no npm script, no doc, no CI job, no lefthook hook**. An orphan that turns on a transport. |
| **`checkCsp` reads `app.security.csp` only** (`:153`). | `devCsp` — the longer, strictly more permissive of the two, and the one this repo's other gate validates — is never checked for a banned token. |
| **It never reads `capabilities/*.json`.** | 24 permission entries, 120 granted commands, one capability with no `windows` scope: unexamined by anything in this repository. |
| **It cannot see the enforced policy**, only the declared one. | The two `'sha256-…'` tokens Tauri appends (§0.4) are outside its universe, as is the fact that `devCsp` is inert on desktop. |
| It reads no `assetProtocol` scope. | §0.5. |

`scripts/check-csp-hosts.mjs` is the complementary instrument and reads **both** `csp` and `devCsp` —
but only their `connect-src`, and only from `tauri.conf.json`. Its own header is the corpus's
canonical example of instrument-before-result (it reported ZERO hosts twice, for two unrelated
reasons, and the exit-2 guard is why anyone found out).

**Where the three gates actually run:**

| Gate | `npm run check` | lefthook | `ci.yml` |
|---|---|---|---|
| `check:tauri-configs` | ✅ | ❌ | ✅ `:151` (red on 10 pre-existing failures) |
| `check:csp-hosts` | ✅ | ❌ | ❌ |
| `census:check` | ✅ | ✅ **pre-push** (`lefthook.yml:74`) | ❌ |

`lefthook.yml:58-64` records why the census moved to pre-push: *"it was enforced NOWHERE: `census:check`
lives only inside `npm run check`, which nothing runs automatically."* **That sentence is still true of
both config gates.** On this machine, the only one of the three that fires without someone typing it
is the census — which is why §9 puts this leaf's ratchet there and specifies the config-gate extension
separately.

### 0.8 — The whole surface, in numbers

| | Count | Note |
|---|---:|---|
| Tauri config files in `src-tauri/` | **5** | 4 `tauri*.conf.json` + `.tauri-scraper-dev.conf.json` |
| …read by `check-tauri-configs.mjs` | **3** | hardcoded list (`:17-18`) |
| CSP strings on disk | **7** | 4 distinct policies (§0.3) |
| …inspected for a banned token by any gate | **1** | `tauri.conf.json`'s `csp` |
| …**actually enforced on this machine today** | **0** | desktop dev applies no CSP (§0.4) |
| Capability files | **2** | read by **0** gates and **0** census rules |
| Permission entries declared | **24** | 15 desktop + 9 mobile |
| …that are blanket `*:default` grants | **13** | §9's signal |
| …that are named `*:allow-*` grants | **11** | §9's positive control. 13 + 11 = 24, exact |
| Plugin commands offered by the built ACL manifest | **193** | across 15 namespaces |
| …granted to `main` on desktop | **120** (62%) | of which `core:default` alone contributes **92** |
| …granted on mobile | **112** | desktop minus `updater` ×4 and 4 window verbs |
| Desktop entries whose marginal contribution is **0** | **6 of 15** (40%) | §0.1 |
| Registered plugins with **zero** granted commands | **1** | `window-state` |
| App `#[tauri::command]` attributes / registered / unregistered | **1,661 / 1,585 / 73** | |
| …gated by a Tauri **capability** | **0** | no `src-tauri/permissions/` ⇒ `has_app_manifest()` false |
| …gated by the app's own `x-ipc-token` | **229** | `PRIVILEGED` 184 + `CLOUD` 50, minus 5 unregistered |
| …**public** | **1,356** (85.6%) | |
| Places the IPC token is published to the page | **1** | `window.__IPC_TOKEN` (`ipc_auth.rs:703`) |
| `assetProtocol.scope` entries | **7** | 1 narrowed to a subdirectory, 6 whole roots |
| `convertFileSrc` call sites | **16** in 7 files | all media/icon; none needs `$APPDATA` |
| Third-party script origins in the packaged `script-src` | **2** | both used, top-level (`useYouTubePlayer.ts:61`) |
| `window.__TAURI__` reads in `src/` | **0** of 4,829 files | `withGlobalTauri: true` since `079cf2604` |
| Census rules in the registry | **157** | **0** read a `.json` file — extensions are `.ts` 68, `.tsx` 75, `.rs` 79, `.mjs` 4, `.js` 4, `.cjs` 3, `.py` 1, `.sh` 1 |

---

## Principle (stack-free head)

Per the [portability test](../research/portability-test.md) the head is physically separated and every
clause carries its warrant. No file path, primitive name or count appears below this line until the
head ends.

> **P1 — physics, and it is this leaf's subject.** *A capability policy is enforced by whichever
> component serves the response, so a policy that names a component you do not serve is
> documentation.* A content policy travels on a header or an injected tag; if a development server, a
> CDN, a reverse proxy or a framework's own asset pipeline is what answers the request, the policy the
> application declares never reaches the client. **Ask which process emits the bytes, then ask whether
> it emits the policy** — and never treat a config key's *existence* as evidence that it is in force.
>
> **P2 — physics, and the one that inverts intuition.** *The mode you develop in is the mode with the
> weakest enforcement, so the policy you exercise daily is the one you have never tested.* The
> production policy is enforced on a machine no developer is watching; the development policy is
> relaxed on purpose and is often not applied at all. Every intuition about "does the app work under
> the policy" is therefore formed under the wrong policy. **Test the production policy in
> development**, or accept that the first execution of your real policy is a user's.
>
> **P3 — physics.** *A per-platform configuration override is a merge, not a replacement, and the keys
> the override does not mention are the dangerous ones.* An author writing a platform file is thinking
> about the keys they type. The keys they do not type keep the base value silently — including
> security keys whose base value was chosen for a different platform with different threats.
> **Materialize the merged configuration and read it**, because the file you edited is not the
> configuration that ships.
>
> **P4 — physics, and the most expensive.** *A checker that enumerates its own inputs is a second copy
> of the inventory, and it will be short in the direction that matters.* People list the files they
> are thinking about. The file that gets omitted is the one nobody was thinking about — the new
> platform, the experimental variant, the one somebody added in a hurry — which is exactly where an
> unreviewed setting lives. **Discover the inputs; never list them.** A gate with a hardcoded file
> list reports green on the file it cannot see, and green is indistinguishable from safe.
>
> **P5 — physics.** *A permission set is not a sum of its entries; it is the union of their closures,
> and a broad entry silently voids every narrow one beside it.* Granting a component's default bundle
> and then hand-picking three of its verbs reads as least privilege and is not: the picking has no
> effect. **Measure each entry's marginal contribution, not the entry count** — a policy where 40% of
> the lines do nothing is a policy whose author believed they were narrowing and were not.
>
> **P6 — physics, and the one a permission model is most often assumed to cover.** *A capability
> system gates what it was built to gate, and an application's own extension points are usually
> outside it.* Platform ACLs govern platform surfaces. The commands you wrote yourself are, by
> default, ungoverned — because the platform has no vocabulary for them until you give it one.
> **Write down which door the ACL is on**, and if your own doors are not on it, say so where a reader
> will look, not in a file only you have read.
>
> **P7 — physics.** *A secret that a script in the page can read is not a control against a script in
> the page.* Tokens introduced to fix an ordering or initialisation problem get read as authorization
> because they look like authorization. The test is not whether the value is random; it is whether the
> adversary's code runs in the same realm as the value. **State the threat a token addresses at the
> place it is defined**, or the next reader will bank it against a threat it does not touch.
>
> **P8 — physics, and the clause with the widest blast radius.** *A file-serving protocol scoped to a
> directory grants everything in that directory, including the things you put there later.* Scopes are
> written once, when the directory holds media. Databases, key material, logs and backups arrive
> afterwards and inherit the grant. **Scope to the subdirectory the feature reads, never to the root
> the application owns** — and re-derive the scope whenever anything new is written into it.
>
> **P9 — physics.** *A script source and a frame source are not the same permission, and only one of
> them shares your realm.* Embedding third-party content in an isolated frame costs nothing;
> loading a third-party script into your own document hands that origin every capability the document
> has. Feature work that needs both will ask for both in one change. **Grant the frame; refuse the
> script**, and if the script is unavoidable, treat that origin as having every capability the page
> has and size the page's capabilities accordingly.
>
> **P10 — ergonomics, security-load-bearing.** *A capability granted for a component outlives the
> component.* Removing a window, a view, or a feature deletes its code and never its permissions,
> because permissions live in a file the deletion did not touch. **Tie every grant to a named consumer
> at the moment you write it, and re-derive the grant list from consumers rather than editing it** —
> a grant nobody reads is indistinguishable from a grant somebody needs.
>
> **Scale condition.** P1 and P2 bite the day a dev server is introduced — which is day one. P3 bites
> the first time a second platform is targeted. P4 bites the second config file. P5 bites the first
> time anyone claims least privilege. P6 and P7 bite when the first reviewer asks "what is this
> protecting". P8 bites when the second kind of file enters a scoped directory. P9 bites the first
> third-party embed. P10 bites at the first deletion, and is discovered years later.

---

## 1. Trigger

You are in this situation when you are about to type or say:

- "the app can't reach that URL" · "add the host to the CSP" · "it works in dev but not in the build"
- "just add the permission to the capability file" · "add `core:default` and move on"
- "grant it on mobile too" · "the Android build needs a different CSP"
- "turn on `withGlobalTauri` so I can poke at it from the console"
- "let the frontend read that folder directly instead of adding a command"
- "load their SDK script and we get the player for free"
- **If you are about to edit `src-tauri/tauri.conf.json`, `src-tauri/tauri.*.conf.json`, or any file
  under `src-tauri/capabilities/`, you are in this situation.**
- **If you are about to write `document.createElement('script')` with a `src` you do not host, you are
  in this situation and P9 is about you.**
- **If you are about to add a filename to a checker's list of files, you are in this situation and P4
  is about you.**
- If you are about to add a `$SOMETHING/**` to `assetProtocol.scope`, P8 is about you.

**Not this path:** whether a second HTTP transport should exist is
[second-transport-exposure](./second-transport-exposure.md); the route table is
[inbound-endpoint-surface](./inbound-endpoint-surface.md); the app's *own* API-key scope vocabulary is
[least-privilege-scope-grant](./least-privilege-scope-grant.md); values baked in at build time are
[compile-time-env-embedding](./compile-time-env-embedding.md); compiling a surface in or out is
[feature-flagged-compilation](./feature-flagged-compilation.md); validating a path argument inside a
command is [command-input-validation](./command-input-validation.md); handing a URL to the OS is
[external-url-opening](./external-url-opening.md).

---

## 2. The one way

**Write the policy once, prove it is applied, and grant only what a named consumer reads — then make
the checker find its own inputs so the next config file cannot be born unexamined.** Concretely:
declare the production CSP and **run development under it**, because a policy that only the packaged
build enforces is a policy whose first real execution ships to a user; if the framework will not apply
the policy behind a dev server, either proxy the dev server through the app's own asset protocol or
state at the top of the config, in a comment nobody can miss, that the development policy is inert and
which platform it is for. **Never add a third-party origin to `script-src`** — grant `frame-src` and
put the vendor in an iframe, because a script in your document holds every capability your document
holds, and in a desktop shell that is the whole IPC surface. **Grant capabilities per named command,
never per default bundle**, and scope every capability to the windows it applies to, because a
capability with no window clause covers webviews that do not exist yet — including the one you will
later point at a third party's login page. **Scope a file-serving protocol to the subdirectory the
feature reads**, never to the application's own data root, because the database, the key file and the
crash logs move in afterwards and the scope does not notice. **Assume the platform ACL does not cover
your own commands** until you have read the code that decides, and if it does not, say so at the top
of whatever you built instead — and never count a value the page can read as a credential against the
page. **Make every checker enumerate its inputs by globbing the directory**, not by listing filenames,
and make it fail loudly when the glob finds nothing; a gate with a hardcoded file list is green on the
file it never opened, and that file is where the unreviewed setting is. Finally, **tie each grant to
its consumer in the same change** — a comment naming the call site, or better, a test that fails when
the consumer disappears — because the component gets deleted and the permission does not.

If you must get one thing right first: **prove the policy is applied.** Every other clause here is
advice about a string that may not be in force.

---

## 3. Mandated primitives

**Exist today — use them:**

| Primitive | What it gives you |
|---|---|
| **`scripts/check-tauri-configs.mjs:141` `parseCsp` + `:152` `checkCsp` + `:138` `SCRIPT_DIRECTIVES` / `:139` `BANNED_CSP_TOKENS`** | **The correct CSP assertion, already written.** It parses directives instead of substring-matching (the header at `:123-134` records why that distinction cost a false failure), it separates `style-src 'unsafe-inline'` from a script-execution risk, and it fails rather than skips on a missing key (`:157-162`). **The logic is right; only its input list is wrong.** Point it at every config and it fires on the real violation today. |
| **`scripts/check-csp-hosts.mjs:151-161` — the instrument-before-result guard** | Exit **2** when zero fetch hosts or zero `connect-src` hosts are found. Its header (`:64-97`) is the corpus's best worked example: the same file reported ZERO twice for two different reasons, and the guard is the only reason anyone knew. **Copy this block into any new config checker before you write its logic.** |
| **`src-tauri/capabilities/default.json:5` `"windows": ["main"]`** | The scoping clause that keeps 120 commands off the `oauth` webview. Small, correct, and the only window scoping in the repo (`mobile.json` has none — §7.D). |
| **The absence of a `remote` clause in both capability files** | Combined with `tauri-2.11.2/src/webview/mod.rs:1820-1852`, this is what makes Google's consent page — running in-process at `auth.rs:444` — unable to invoke anything. **It is a control that consists of not having written something. Do not "complete" these files by adding `remote`.** |
| **`src-tauri/src/ipc_auth.rs:117` `PRIVILEGED_COMMANDS` + `:617` `wrap_invoke_handler`** (installed at `lib.rs:590-594`) | The boundary the platform does not provide (P6), with the best inline documentation in the repository: every deliberate omission is a commented-out entry naming the WebView2 race that caused it (`:245-252`, `:425-433`), and every promotion names the date and the reason. **Copy the discipline.** Its two self-tests (`:1034`, `:1156`) are drift guards with instrument assertions (`checked > 50`, `found.len() > 150`) — the same fail-loud shape as the census. |
| **`src-tauri/tauri.conf.json`'s `"$DOCUMENT/Personas Media Studio/**"`** | **The one asset-protocol scope entry done right** — narrowed to the subdirectory the feature writes. It is the model for the other six (§7.B). |
| **`src-tauri/Cargo.toml:162-187` — the `open` feature comment** | 26 lines explaining that `shellexecute-on-windows` is a security fix, with the two replayed injections that prove it and the reason no validation layer could substitute for the launcher. **This is what a permission change should look like in a manifest.** Owned by [`external-url-opening`](./external-url-opening.md); cited here as the shape. |
| **`scripts/census/lib/engine.mjs` + `rules.json`** | The ratchet, and the only one of the three gates that runs automatically on this machine (`lefthook.yml:74`, pre-push). §9. |

**Do not exist — this path names them:**

- **A config-file inventory.** Nothing enumerates `src-tauri/*.conf.json`. Both checkers carry a
  hand-written list; a fifth config (`.tauri-scraper-dev.conf.json`) is in neither, and no npm script,
  doc, CI job or hook mentions it.
- **Any reader of `capabilities/*.json` outside Tauri's own build.** 24 permission entries, 120
  granted commands, 0 gates, 0 census rules, 0 tests.
- **A CSP assertion that covers `devCsp` or any platform config.** `checkCsp` reads `app.security.csp`
  of three files.
- **Any statement, anywhere, that `devCsp` is not enforced on desktop.** Not in the config, not in
  `check-csp-hosts.mjs` (which validates it), not in `CLAUDE.md`, not in `docs/`.
- **A grant→consumer link.** No comment, test, or generated artifact ties any of the 24 permission
  entries to a call site, which is why `window-state` has 0 grants, `core:app:default` has 0 effect,
  and `withGlobalTauri` outlived its window by three months.
- **An `assetProtocol` scope narrower than the app's data root**, and any test that a new file written
  into `app_data_dir()` is not thereby published.

---

## 4. Steps

1. **Decide which process serves the renderer's HTML, in every mode you ship, and write it down at the
   config.** `tauri build` → the app's own asset protocol → the CSP applies. `tauri dev` on desktop →
   Vite → **no CSP applies**. `tauri android dev` → proxied through the asset protocol → `devCsp`
   applies. If you skip this step, every later step is about a string that is not in force.
2. **Make development run the production policy.** Simplest honest form: delete `devCsp` — `csp()`
   falls back to `csp` (`manager/mod.rs:378-379`) — and add whatever dev needs to `csp` behind a
   comment. If you keep two policies, put the enforcement matrix from step 1 in a comment beside them.
3. **Write the capability with named commands, then measure.** Resolve the file against
   `gen/schemas/acl-manifests.json` and print the *marginal* contribution of each entry. Any entry
   contributing 0 is either redundant or evidence that a broader entry above it already opened the
   door. Six of fifteen fail this test today.
4. **Give every capability a `windows` clause**, even when there is one window. The clause is what
   makes a future webview — an OAuth popup, a preview pane, a plugin surface — default to *nothing*.
5. **Scope the asset protocol to the subdirectory the feature reads.** Not `$APPDATA/**`. Enumerate
   what `convertFileSrc` is actually called with; here that is persona icons, artist media and media-
   studio assets, all of which live in named subdirectories.
6. **Grant `frame-src`, refuse `script-src`, for anything you did not write.** If a vendor SDK must
   run in your document, record in the same commit that this origin now has your full IPC surface, and
   have the reviewer size that against §0.6.
7. **Check every platform config by materializing the merge.** Run the platform build once and read
   `gen/<platform>/…/tauri.conf.json`; assert the keys you did not write are the values you want.
   The merge is RFC 7386 (`tauri-utils-2.9.2/src/config/parse.rs:7,193-204`), so every key your
   platform file omits keeps the desktop value.
8. **Make the checker glob.** `readdirSync('src-tauri').filter(f => /(^|\.)tauri.*\.conf\.json$/)`
   plus `readdirSync('src-tauri/capabilities')`, and exit non-zero if either yields fewer files than a
   floor. Then check `csp` **and** `devCsp` in each.
9. **And then stop.** Whether an HTTP transport should exist is
   [second-transport-exposure](./second-transport-exposure.md); the route table is
   [inbound-endpoint-surface](./inbound-endpoint-surface.md); the app's own scope vocabulary is
   [least-privilege-scope-grant](./least-privilege-scope-grant.md); redacting a response is
   [telemetry-scrubbing](./telemetry-scrubbing.md).

### Can the type make the wrong call impossible? — asked before §9

**No for the CSP, no for the capabilities, and the honest answer is that this whole leaf lives in the
one place types cannot reach — which is why the corpus has never had a rule here.**

Hold it against the seven qualifications:

- **Q3 (a type nobody constructs constrains nothing).** The construction sites are **JSON literals**
  in 5 config files and 2 capability files. There is no constructor. Tauri *does* ship JSON Schemas
  (`gen/schemas/desktop-schema.json`, 139 KB) and both capability files reference one — and a schema
  can express "this is a valid permission id", never "this permission is one the app uses" or "this
  CSP is enforced". The one violation in the tree (`'unsafe-eval'`) is a **schema-valid** value.
- **Q1 (a required prop carries only what it encodes).** Making `windows` required on a capability
  would close §7.D and nothing else. Making `devCsp` required would make §0.4 worse, not better: the
  problem is that the field exists and is inert.
- **Q5/Q6 (withholding beats requiring; withhold the dangerous freedom).** The one genuine withholding
  available is **deleting `devCsp`**, which withholds the dangerous freedom (a second policy on a
  clock nobody can observe) while keeping the answer (a working dev build). It is a one-line config
  edit, it is the strongest fix in this document, and it **changes what the WebView may load** — so it
  is a §7 note, not an apply.
- **The wall, and it is doctrine item 1 and item 4 at once.** The value is inside a JSON string
  literal that no compiler parses, on the far side of a serialization boundary that the framework
  reads at runtime. `tauri-build` validates the *shape* and cannot validate the *meaning*. **No type
  in Rust or TypeScript reaches any statement in this document.**

That is the finding, not a failure: **this is the case where a counting gate genuinely earns its
place** — and §9 is where it goes, with a second, non-census instrument for the part counting cannot
express.

---

## 5. Anti-patterns

| Anti-pattern | Failure mode |
|---|---|
| **A `devCsp` beside a `csp`** | Two policies on two clocks. On desktop the dev one is never applied and the prod one is never exercised — so the policy you test is *none* and the policy that ships is *untested*. Measured: `PROXY_DEV_SERVER = cfg!(all(dev, mobile))`, `cargo:dev=true` in all 10 debug build outputs. |
| **A checker with a hardcoded list of config files** | It is green on the file it never opened, and that file is where the unreviewed setting is. Measured: the one `BANNED_CSP_TOKENS` hit in the repo is in the one config `check-tauri-configs.mjs` does not read. |
| **`core:default` plus hand-picked `core:window:allow-*`** | The picking is inert. Measured: `core:default` = 92 of 120 commands; 6 of 15 entries contribute **0**; the file reads as least privilege and is not. |
| **A capability with no `windows` clause** | It covers webviews that do not exist yet. `mobile.json` grants 112 commands to every window an Android build ever creates. |
| **A third-party origin in `script-src`** | That origin gets your document's full capability set. Here: `window.__TAURI__` (120 plugin commands), `window.__IPC_TOKEN`, 1,585 app commands, and `fetch('http://asset.localhost/…')` over the app data directory. `useYouTubePlayer.ts:61-65`. |
| **`withGlobalTauri: true` "for debugging"** | It survives the debugging. **0 readers in 4,829 files**, three months after the window it was added for was deleted (`079cf2604`). |
| **A session token assigned to `window`** | It cannot defend against code running in that window, which is the only place IPC originates. `ipc_auth.rs:703`. The token's real job — surviving a WebView2 patch race — is real and is a different job. |
| **`assetProtocol.scope` naming an app-owned root** | Everything written there later is published. `$APPDATA/**` today contains a 347 MB database, two backups, and `master.key`. |
| **Assuming a platform ACL covers your own commands** | It covers what it was built to cover. Measured: no `src-tauri/permissions/` ⇒ `has_app_manifest()` false ⇒ **0 of 1,585**. |
| **A platform config that overrides `csp` and not `devCsp`** | The merge keeps the base value. Measured from the materialized merge: the Android config inherits the *desktop* `devCsp`, on the one platform where `devCsp` is actually enforced. |
| **A config file that enables a feature and is wired to nothing** | `.tauri-scraper-dev.conf.json` turns on `test-automation` (46 unauthenticated routes) and `scraper`, and is referenced by no script, doc, hook or job. It is a loaded gun with no trigger and no safety catch either. |
| **`beforeBuildCommand` that skips the codegen the other configs run** | `tauri.android.conf.json` runs `npx vite build` — **0 of the 14 declared codegen tasks**, 0 of the 13 in the `prebuild` preset — while inheriting `bundle.resources: {"resources/skills": "skills"}`, a directory only `scripts/sync-system-skills.mjs` creates and `.gitignore`s. |
| **A version in a generated config nobody re-generates** | The merged Android config on disk says `0.1.6`; `tauri.conf.json`, `package.json` and `Cargo.toml` all say `1.1.0`. |

---

## 6. Evidence

### The one site to copy: `scripts/check-tauri-configs.mjs:103-195`

Not because it is complete — §0.7 is a list of what it misses — but because **its reasoning is the
part that is hard and it got that right**, and the misses are all one edit away:

- It **parses directives** rather than substring-matching the policy, and the comment says why
  (`:123-134`): the first version did `csp.includes("'unsafe-inline'")` and immediately failed the
  clean tree, because `style-src 'unsafe-inline'` is present, normal and required. *"A substring match
  answers 'does this text appear', never 'is this a thing'."*
- It **fails rather than skips** on a missing key (`:153-165`), with the reason on record: four gates
  in this repo shipped that silently passed on absent input.
- It **names its own escape hatch and forbids using it quietly** (`:178-183`): *"If this is deliberate,
  remove the token from `BANNED_CSP_TOKENS` with a written reason — never weaken it silently."*
- It **states the stake**, which is the sentence this whole document is a footnote to (`:110-116`):
  *"`withGlobalTauri: true` exposes the IPC surface to any script that executes in the renderer, so
  script execution is not a session-cookie problem, it is local command execution… the CSP is doing
  more work than every sanitizer combined, while being the only one of them that nothing verifies."*

**Also exemplary:**

- **`scripts/check-csp-hosts.mjs:151-161`** — instrument-before-result, with the two failures that
  earned it written into the header.
- **`src-tauri/src/ipc_auth.rs:1034-1053` and `:1156-1213`** — two drift guards over the same
  registry from two directions (call sites, then annotations), each with an instrument assertion
  (`checked > 50`, `found.len() > 150`) and a `DRIFT_BASELINE` that *may only shrink*, with a prose
  reason per entry. This is the shape a permission allowlist should have.
- **`src-tauri/Cargo.toml:162-186`** — a 26-line comment turning a one-word feature flag into a
  reviewable security decision, including the exact strings that were replayed to prove it.
- **The two commented-out blocks in `PRIVILEGED_COMMANDS` (`:243-252`, `:425-433`)** — a deliberate
  non-grant, kept in place, with the platform bug that forced it and the compensating inner guard both
  named. A deleted line would have looked identical and taught nothing.

### The oracle — five siblings, and the cohort is 1

Swept `../personas-web`, `../brainiac`, `../personas-cloud`, `../vibeman`, `../ascent`.

**Establish the cohort first, per the doctrine.** This leaf is about a *desktop WebView shell's*
capability boundary. **Four of the five siblings have no WebView shell at all** — no `src-tauri/`, no
Electron, no `@tauri-apps/*` dependency:

| Sibling | `src-tauri/` | `capabilities/` | Tauri dep | any CSP |
|---|---|---|---|---|
| `personas-web` | — | — | none | ✅ Next.js response header |
| `brainiac` | — | — | (no `package.json`) | — |
| `personas-cloud` | — | — | none | — |
| **`vibeman`** | **✅** | **❌ none** | `@tauri-apps/api` + `cli`, `tauri = "2"` | ✅ one `csp`, no `devCsp` |
| `ascent` | — | — | none | — |

**Effective independent cohort for the capability half: 1 of 5. For the CSP half: 2 of 5.** That is a
**structural absence**, not a silence about the practice — four repos are not in a position to have an
opinion, and reporting "4 of 5 don't do this" would be reporting the wrong thing. `vibeman` is a
different product by the same operator (it generated this repo's `context-map.json`); its config shares
no comment text, no constant and no error string with ours, so it is not a port and counts as
independent.

Clause by clause:

| Clause | Verdict |
|---|---|
| **Ban `'unsafe-inline'`/`'unsafe-eval'` in `script-src`** | **The fleet converged on the disease.** `vibeman/src-tauri/tauri.conf.json` ships `script-src 'self' 'unsafe-inline' 'unsafe-eval'` in a Tauri **v2 desktop** app. `personas-web/next.config.ts:38` and `vibeman/next.config.ts:43` ship `script-src 'self' 'unsafe-inline' 'unsafe-eval'` too. **3 of 3 policies in the fleet outside this repo carry both tokens; Personas' desktop `csp` carries neither.** Personas is *ahead*, and an oracle counting agreement would read this as the strongest possible confirmation of the opposite. Always ask what the siblings agreed *to do*. |
| **Split `csp` / `devCsp`** | **Silence — 0 of 1.** `vibeman` declares one `csp` and no `devCsp`, on the same Tauri 2 with the same `devUrl: http://localhost:1420`. Given §0.4, `vibeman`'s single policy is the *correct* arrangement and this repo's split is the local calibration. **House convention, and a harmful one.** |
| **Declare capabilities explicitly** | **Absence — `vibeman` has no `capabilities/` directory at all**, so it grants nothing to JS and its `tauri-plugin-shell` commands are unreachable from the renderer. Personas' 2 files are the fleet's only capability declaration. Not physics; nothing to corroborate. |
| **Scope a capability to named windows** | **Silence — 0 of 1.** No sibling has a capability to scope. |
| **`withGlobalTauri`** | **Personas is the only repo that enables it.** `vibeman` leaves it at Tauri's default (off). **1 of 2 — and the one that turned it on has zero readers.** |
| **`assetProtocol`** | **Silence — 0 of 1.** `vibeman` does not enable it and does not depend on `protocol-asset`. |
| **A plugin scope written in a shape the framework no longer reads** | **Reinvented, in the sibling, in the other direction.** `vibeman/src-tauri/tauri.conf.json` carries `plugins.shell.scope` with a five-command allowlist (`claude`, `gemini`, `git`, `npm`, `node`, all `args: true`) — the **Tauri v1** scope shape, in a **v2** config, where scopes live in capabilities. With no `capabilities/` directory, that allowlist governs nothing. **Same failure family as `withGlobalTauri` here: a permission decision written where nothing reads it.** Reported, not edited — it is their repo. |
| **A checker that globs rather than lists** | **Silence — no sibling has a config checker.** `check-tauri-configs.mjs` and `check-csp-hosts.mjs` are, as far as this fleet goes, unique artifacts. P4 is stated as physics on the *reasoning*, not on external warrant, and is labelled so. |

**Net: one clause has external warrant and it points the wrong way from where the brief pointed.** The
`'unsafe-*'` ban is *not* corroborated — it is contradicted 3-for-3, with Personas alone in the correct
position. Everything else is silence over a cohort of one, and the `csp`/`devCsp` split is a house
convention that the single comparable sibling declined and is better for declining.

### Two independent implementations, and what they disagreed about

The `generate_handler!` registration list was extracted twice. A regex sweep over the
comment-stripped, brace-matched body returned **1,591**; a depth-0 comma split with per-entry
attribute-line filtering returned **1,585**. The six-entry disagreement was `path`, `lines`, `found`,
`src`, `broken`, `declared` — **English words at the ends of lines**, matched because the regex used
`$` under the `m` flag and doc-prose survives a `//`-stripper when it is inside a `#[cfg]`-adjacent
block. **The naive-looking implementation was the wrong one, and the tell was that the extra entries
were not identifiers.** 1,585 is the count used throughout; it agrees with the 1,661
`#[tauri::command]` attributes minus 73 unregistered and 3 duplicate names.

The capability resolution was likewise cross-checked: 15 declared entries resolving to 120 commands,
and 15 per-entry resolutions summing (with dedupe) to the same 120. The 13 + 11 = 24 partition in §9 is
a third, independent check on the same two files from a completely different matcher.

---

## 7. Deviations found

> **Second pass — what is upstream of all of this.** Every entry below reduces to one absence: **no
> artifact in this repository reads the files that grant capability.** Two gates read three of five
> config files and one of three CSP strings; zero read either capability file; zero of 157 census
> rules read a `.json` file at all. Because nothing reads them, a policy can be inert (7.A), a scope
> can outgrow its purpose (7.B), a grant can outlive its consumer (7.C), a capability can lose its
> window clause (7.D), and a banned token can sit in the tree under a green gate (7.E) — all
> simultaneously, all invisible, all shipped. Point the readers at the files and 7.D and 7.E become a
> failing check today.

### 7.A — P1/P2 (**P0**): `devCsp` is never applied on desktop, and the checker that validates it says otherwise

`src-tauri/tauri.conf.json:38` declares a 1,100-character `devCsp`. `tauri-2.11.2/src/manager/webview.rs:43`
(`PROXY_DEV_SERVER = cfg!(all(dev, mobile))`) plus `manager/mod.rs:369-381,440` mean it is applied only
when `dev && mobile`. This project's daily commands (`tauri:dev`, `tauri:dev:lite`,
`tauri:dev:stable`, `tauri:dev:test`) are all `dev && !mobile`. Confirmed against build-script output
on disk (10× `cargo:dev=true` in `target/debug`, `cargo:dev=false` in `target/release`).

Two live consequences:

1. **Development runs with no CSP.** Every safety property in §0.6 is unmitigated in the mode the app
   is developed and demoed in.
2. **`scripts/check-csp-hosts.mjs:139-141` fails the build when a frontend fetch host is missing from
   `devCsp`.** It is enforcing completeness of a list that governs nothing on desktop. The gate is
   useful for `csp`; for `devCsp` it manufactures confidence.

**Deferred, not applied.** Deleting `devCsp` (so `csp()` falls back at `manager/mod.rs:378-379`) is the
one-line fix and it **changes what the WebView may load** in the operator's daily driver. Out of bounds
per the brief. The zero-risk half — a comment at `tauri.conf.json:38` and at `check-csp-hosts.mjs:139`
recording the enforcement matrix — is also deferred, because this document may write only itself.

### 7.B — P8 (**P0**): the asset protocol publishes the vault key file and the database

`tauri.conf.json:31-38` scopes `assetProtocol` to `$APPDATA/**` and `$APPLOCALDATA/**`.
`$APPDATA` = `app_data_dir()` (`tauri-2.11.2/src/path/mod.rs:332`) = `%APPDATA%\com.personas.desktop`,
which holds `master.key` (358 B), `personas.db` (347,054,080 B), `personas_data.db`, two full
historical DB copies, `logs/`, `crash_logs/` and `backups/`. `connect-src` lists `asset:` and
`http(s)://asset.localhost` in **both** the packaged and dev policies, so those bytes are `fetch`-able
by any script in the renderer, with `Range` support, in the packaged build, with the packaged CSP
enforced (`tauri-2.11.2/src/protocol/asset.rs:29-120`).

Nothing in the app needs it: all **16** `convertFileSrc` call sites are in
`features/plugins/artist/**` (media studio, gallery, waveforms, thumbnails) and
`lib/icons/customIconStore.ts`, which read `{app_data_dir}/persona-icons/…`
(`commands/core/persona_icons.rs:54-59`) and `{app_data_dir}/media-studio/…`
(`commands/artist/persistence.rs:8,282`).

**Fix (deferred — it changes what the WebView may load):** replace `$APPDATA/**` with
`$APPDATA/persona-icons/**`, `$APPDATA/media-studio/**` and `$APPDATA/drive/**`, and drop
`$APPLOCALDATA/**` entirely (it holds only `EBWebView`, the WebView2 profile). Then narrow
`$PICTURE`, `$VIDEO`, `$AUDIO`, `$DOWNLOAD` the way `$DOCUMENT/Personas Media Studio/**` already is.

### 7.C — P9/P10 (**P1**): a third-party script in the top-level document, and a global that outlived its window

`src/features/plugins/radio/hooks/useYouTubePlayer.ts:61-65` appends
`<script src="https://www.youtube.com/iframe_api">` to `document.head`. `script-src` permits it and
`s.ytimg.com` (which the API loads next). That origin then holds everything in §0.6.

`tauri.conf.json:15` sets `withGlobalTauri: true`, added by the same commit (`079cf2604`, 2026-05-09)
for a hidden `WebviewWindow` labelled `radio` described in its own message. **That window does not
exist in the tree.** `window.__TAURI__` has **0 occurrences in 4,829 `src/` files** and 0 in
`index.html`; its four tree-wide uses are dev scripts driving the app through the test-automation
`/eval` route, which is compiled out of release.

**Fix (deferred — both halves change what the WebView may load):** set `withGlobalTauri: false`
(costs the three dev scripts, which can use `__TAURI_INTERNALS__.invoke`), and move the YouTube player
into the `frame-src`-permitted iframe it already has, dropping `https://www.youtube.com
https://s.ytimg.com` from `script-src`.

### 7.D — P5 (**P1**): the capability files

Four defects in 24 lines:

1. **`mobile.json` has no `windows` clause** — 112 commands granted to every window an Android build
   creates, present and future. `default.json:5` shows the correct form.
2. **6 of 15 desktop entries grant nothing** (§0.1). `core:app:default`, `core:event:default` and
   `core:window:allow-is-maximized` are inside `core:default`; the three `notification:allow-*` are
   inside `notification:default`.
3. **`core:default` grants 92 commands** including all 22 `core:menu`, all 12 `core:tray`,
   `core:image:from_path`, `core:webview:internal_toggle_devtools` and 28 `core:window` verbs. The
   app's own UI is a custom titlebar (`decorations: false`) and a tray icon built in Rust
   (`tray.rs`); **the JS-side menu and tray APIs have no call site in `src/`.**
4. **`updater:default` grants `download_and_install`** to the renderer while
   `plugins.updater.endpoints` points at a GitHub `latest.json`. The mobile capability correctly
   omits it — and `tauri.android.conf.json` still **inherits `plugins.updater`** through the merge, so
   the Android bundle carries the desktop updater's pubkey and endpoint with no permission to use
   them. Harmless today; it is the shape of P3.

**Fix (deferred — every one of these changes what the renderer may do):** add
`"windows": ["main"]` to `mobile.json`; delete the six inert entries; replace `core:default` with the
named `core:event:*`, `core:path:*`, `core:app:*` and `core:window:*` commands the app calls.

### 7.E — P4 (**P1**): the banned token is in the file the ban does not read

`tauri.android.conf.json:11` — `script-src 'self' 'unsafe-eval'`. `BANNED_CSP_TOKENS`
(`check-tauri-configs.mjs:139`) contains `'unsafe-eval'`. `CANONICAL`/`OVERLAYS` (`:17-18`) name three
files, none of them this one. Running the script's own `checkCsp` over the android config fires
immediately. `'unsafe-eval'` is the token that makes `eval` and `new Function` available — the
difference between "an injected string is inert" and "an injected string executes".

Whether Android needs it is a real question this document cannot answer without a build. If it does,
`BANNED_CSP_TOKENS` has a documented escape hatch (`:178-183`) that requires a written reason — which
is exactly the right outcome and is unreachable while the file is unread.

### 7.F — P4 (**P2**): a fifth config file, wired to nothing, that turns on a transport

`src-tauri/.tauri-scraper-dev.conf.json` — git-tracked, 8 lines, `build.features: ["desktop",
"scraper", "test-automation"]`. No `$schema` (assertion 2 of the gate would flag it). Referenced by no
`package.json` script, no `docs/`, no `.github/`, no `lefthook.yml`. `test-automation` is the feature
that opens the 46-route unauthenticated bridge on `:17320`
([`second-transport-exposure`](./second-transport-exposure.md) P9). It is inert until someone passes
`--config` to it, and the reason nobody has noticed is that nothing looks.

### 7.G — P3 (**P2**): the Android config inherits five keys it never mentions

Measured from `src-tauri/gen/android/app/src/main/assets/tauri.conf.json`, the merged config a real
`tauri android` run produced (2026-03-09). `tauri.android.conf.json` names `identifier`,
`build.{frontendDist,features,beforeBuildCommand}`, `app.security.{csp,freezePrototype}` and
`bundle.{active,targets,android}`. Everything else comes from the desktop config:

| Inherited | Consequence today |
|---|---|
| `app.security.devCsp` | The desktop dev policy — `http://localhost:*`, `ws://localhost:*` — is the policy in force on `tauri android dev`, the **one** configuration where `devCsp` is enforced (§0.4). |
| `app.withGlobalTauri` (now `true`) | The merged snapshot shows `false`; the base flipped in May. The next Android build injects `window.__TAURI__`. |
| `app.security.assetProtocol` (now `enable: true`, 7 scopes) | The snapshot shows `{"scope":[],"enable":false}`. The next Android build enables the protocol with `$APPDATA/**`, while the Android `csp` has **no `asset:`** in `img-src`, `connect-src` or `media-src` — enabled and unreachable. A capability granted and simultaneously unusable is the clearest possible sign nobody read the merge. |
| `bundle.resources: {"resources/skills": "skills"}` | Only `scripts/sync-system-skills.mjs` creates that directory, and it is `.gitignore`d (`src-tauri/.gitignore:23-25`) precisely because *"Tauri validates resource paths in DEV as well as build"*. `beforeBuildCommand: "npx vite build"` runs **0 of the 14 declared codegen tasks** and **0 of the 13 in `prebuild`**, and unlike `npm run build` it does not run `sync-system-skills.mjs` directly either. **Predicted, not observed:** a clean-clone `tauri android build` fails on the resource path. |
| `plugins.updater` | Desktop pubkey + a GitHub `latest.json` endpoint in an Android bundle whose capability grants no `updater:*` (§7.D.4). |

**And the versions disagree, config to config.** `tauri.conf.json`, `package.json` and `Cargo.toml`
all read **1.1.0** — they agree, correcting the brief's expectation. The **generated Android config on
disk reads `0.1.6`**, four minor versions behind, because nothing regenerates it and nothing checks it.
That is the *third* stale identity in this area, after `test_automation.rs:939`'s `"version":"0.2.0"`
([`inbound-endpoint-surface`](./inbound-endpoint-surface.md) §12.3).

### 7.H — P6/P7 (**P2**, structural, mostly not a bug): the boundary the ACL is not on

Stated as a deviation because **nothing in the repository says it**, not because the design is wrong.
`has_app_manifest()` is false, so Tauri's ACL gates 0 of 1,585 app commands from a local origin
(`webview/mod.rs:1820-1824`). The replacement — `ipc_auth.rs` — is a string allowlist covering **229**,
leaving **1,356 public**, and its token is on `window` (`:703`). `ipc_auth.rs`'s own module docstring
calls the wrapper *"the primary security gate"* (`:14`) — true of the 229, and true against a *timing*
failure rather than against a script in the page.

**No fix proposed.** Re-tiering commands is *"a security control whose current setting may be
deliberate"*, the file documents each deliberate omission with the platform bug behind it, and the
runbook is explicit. What is owed is a paragraph at `ipc_auth.rs:1-27` naming the threat model: this
protects against *ordering*, not against *renderer compromise*; the CSP is what protects against
renderer compromise; and 1,356 commands are outside both.

### 7.I — P10 (**P3**): grants with no consumer

- `window-state`: registered at `lib.rs:577`, 3 commands offered, **0 granted** in either capability.
- `core:menu` (22) and `core:tray` (12): granted; the app builds its menu and tray in Rust (`tray.rs`)
  and has no JS call site.
- `updater` (4) on desktop: `updater:check` is reachable from JS; whether the app calls it from JS or
  from Rust is a one-line check nobody has an artifact for.
- `withGlobalTauri` (§7.C).

None of these is exploitable on its own. Together they are the measurement behind P10: **four grants,
no consumer, no artifact that would have said so.**

---

## 8. Gaps — what the primitives genuinely cannot do

1. **Nothing can assert that a declared CSP is the enforced CSP.** The enforced policy is assembled at
   runtime by `set_csp` from the declared string plus per-asset script/style hashes, and selected by a
   `cfg` the config cannot see. A static check reads a string; only a running webview knows the
   policy. §9's instrument 2 is the only shape that closes this and it needs the app launched.
2. **`tauri-build` validates permission *ids*, not permission *need*.** A schema-valid capability
   granting 92 commands nobody calls is indistinguishable, to every tool in the toolchain, from a
   minimal one. Marginal contribution has to be computed against the ACL manifest, which no tool does.
3. **The census cannot assert an absence**, so "every config file is read by the gate", "every grant
   has a consumer" and "no scope entry names an app-owned root" are all outside it — the same wall
   [`telemetry-scrubbing`](./telemetry-scrubbing.md) §8 Gap 5 and
   [`inbound-endpoint-surface`](./inbound-endpoint-surface.md) §8.7 hit.
4. **New, and worth adding to the corpus's list of census limits: the census cannot ratchet a
   population that includes generated artifacts whose presence varies by machine.** Measured while
   building §9. The natural rule for this leaf — an unsafe token in any Tauri config — has an anchor
   population of **3 files on this machine** and **1 on a clean clone**, because
   `gen/android/**/tauri.conf.json` appears only after `tauri android` has run and is `.gitignore`d.
   Both halves of the guard break: the `baseline` is machine-dependent, and an `exclude` naming
   `src-tauri/gen/**` is a **stale-exclude structural failure** on a clean clone
   (`engine.mjs:276-288`) because **0 of the tracked `.json` files under `src-tauri/gen` exist there**.
   There is no `roots`/`extensions` combination that sees `tauri.conf.json` and not its generated
   copies — they share a basename. §9 routes around it; the limitation is general and belongs in the
   doctrine.
5. **A CSP host allowlist matches host strings; a socket answers to addresses.** `http://localhost:*`
   and `http://127.0.0.1:*` name the same listeners and are different CSP sources. No tool in this
   repo — including `check-csp-hosts.mjs`, whose `isNonNetworkHost` correctly treats both as
   non-network — reconciles them.
6. **`json_patch::merge` has no "explicitly inherit" marker.** A platform config cannot say "I have
   considered `devCsp` and I want the base value"; silence and consideration are the same bytes. The
   only remedy is to materialize and read the merge (§4 step 7).
7. **`window.__IPC_TOKEN` cannot be withheld** without solving the WebView2 header-forwarding race
   that put it there (`ipc_auth.rs:684-690`, `:245-252`, `:425-433`). Any "fix" that removes it breaks
   privileged commands on the operator's own platform. This is a genuine limitation, not laziness, and
   it is why the CSP carries the weight.

---

## 9. The missing gate

Every deviation above ships green under `npm run check`, `npm run check:tauri-configs`,
`npm run check:csp-hosts`, `npm run census:check`, `npx tsc --noEmit`, `eslint src/`, and the pre-push
lefthook suite.

### 9.1 — The primary instrument is an EXTENSION of an existing gate, not a new one

Per the §9 calibration: `check:tauri-configs` and `check:csp-hosts` already run inside `npm run check`,
and the condition **is** expressible in the first of them. The whole fix is that its inputs are
literals:

```js
// scripts/check-tauri-configs.mjs:17-18 — today
const CANONICAL = "tauri.conf.json";
const OVERLAYS  = ["tauri.lite.conf.json", "tauri.stable.conf.json"];
```

**Specified, not applied** (this document may write only itself; and editing a gate the operator runs
would fail his `npm run check` mid-session):

1. **Discover, do not list.** `readdirSync(tauriDir).filter(f => /\.conf\.json$/.test(f))` — that is
   `tauri.conf.json`, `tauri.android.conf.json`, `tauri.lite.conf.json`, `tauri.stable.conf.json`,
   `.tauri-scraper-dev.conf.json`. Classify by name: the canonical one, platform files
   (`tauri.<platform>.conf.json`), and everything else as an **overlay**, which the existing
   `ALLOWED_OVERLAY_KEYS` check then covers — closing §7.F for free.
2. **Run `checkCsp` over `app.security.devCsp` as well as `csp`**, in every discovered file. Two lines.
3. **Add the fail-loud precondition** the file does not yet have, in the shape
   `check-csp-hosts.mjs:151-161` already models: `process.exit(2)` if the glob yields fewer than 4
   config files, or if `checkCsp` never inspected a policy. Without it, a rename makes this gate
   measure nothing and pass forever — the exact failure its own header (`:118-122`) catalogues in four
   other gates.
4. **Read `capabilities/*.json`**: fail if any capability lacks `windows`/`webviews`; fail if any
   declares `remote` without a written reason; **warn** listing every entry whose marginal contribution
   against `gen/schemas/acl-manifests.json` is 0 (guarded by `existsSync`, since that file is
   generated).

**On today's tree, steps 1+2 alone fail immediately on `tauri.android.conf.json`'s `'unsafe-eval'`,**
which is the single highest-value assertion in this document and requires no new file.

**The condition step 4 is a proxy for, stated so an adopting repo can re-derive it:** *a permission
entry whose closure is already contained in the closure of another entry in the same grant.* In a
browser-extension manifest that is a `permissions` entry subsumed by a broader `host_permissions`; in
an IAM policy, a statement subsumed by a wildcard action in the same document; in a Kubernetes Role, a
rule subsumed by a `*` verb. **Do not port the JSON shape** — port "resolve every entry and diff the
closures".

### 9.2 — The census rule: a blanket default grant

**Existing rules checked for overlap.** All **157** rules in `scripts/census/rules.json` were read.
The overlap answer is structural and total: **the registry's extension set is `.ts` (68), `.tsx` (75),
`.rs` (79), `.mjs` (4), `.js` (4), `.cjs` (3), `.py` (1), `.sh` (1) — and `.json` (0).** No census rule
in the corpus has ever read a configuration file, and a `.json` file and a `.rs` file cannot be the
same match. Site overlap with every existing rule is **0 by construction**. The four rules whose
territory is nearest were still checked by name:

| Rule | Roots / ext | Why it does not collide |
|---|---|---|
| `least-privilege-scope-grant`'s rule | `src-tauri` `.rs` | The app's **own** scope vocabulary (`personas:read`, `proxy`) in Rust. Different vocabulary, different file type. |
| `build-gated-ipc-entrypoint` | `src-tauri/src` `.rs` | The `generate_handler!` registration list under `#[cfg]`. Adjacent (§0.2 counts the same list) but a different condition and a different unit. |
| `config-value-frozen-at-compile-time` | `src`,`scripts` | `import.meta.env` reads. Touches "configuration" but never a config **file**. |
| `unverifiable-generated-artifact` | `scripts` `.mjs` | Codegen scripts. `check-tauri-configs.mjs` is a *checker*, not a generator, and carries no generated-artifact signal. |

**The condition the signal is a proxy for:** *a capability grant names a component's entire default
permission bundle instead of the individual operations the application performs, so the grant's real
extent is a property of the framework's version rather than of this application's needs.* In this
stack it is a `"<ns>:default"` string in `src-tauri/capabilities/*.json`. In a browser extension it is
`"<all_urls>"` in `permissions`; in AWS IAM it is `"Action": "s3:*"`; in a Kubernetes RBAC Role it is
`verbs: ["*"]`. **Do not port the regex** — re-derive the "whole bundle" spelling for your own grant
language.

**Why a count and not a type:** §4 answers *no* on all seven qualifications. The value is a JSON string
literal with no constructor, and the one violation in the tree is schema-valid. There is nothing to
make unrepresentable.

**Why the census and not another script:** the census is the only one of the three gates that runs
automatically on this machine (`lefthook.yml:74`, pre-push), and `lefthook.yml:58-64` already records
that `npm run check` "nothing runs automatically". §9.1 is the *right* instrument and it runs when
someone types it; this is the ratchet that runs when they do not.

**Roots are the stable half of §8 Gap 4.** `src-tauri/capabilities/` contains exactly two git-tracked
files on every machine and every clean clone — no generated copies, no `.gitignore` interaction, no
`gen/`. The floor of 2 is not decoration: if the directory is renamed, emptied, or moved, the walk
drops below it and the rule fails structurally instead of reporting a clean codebase.

```json
{
  "id": "blanket-default-permission-grant",
  "goldenPath": "docs/concepts/golden-paths/tauri-permissions-and-csp.md",
  "title": "A Tauri capability grants a plugin's ENTIRE default permission set instead of the named commands the app actually calls",
  "roots": ["src-tauri/capabilities"],
  "extensions": [".json"],
  "signal": {
    "pattern": "\"[a-z][a-z0-9-]*(?::[a-z0-9-]+)?:default\"",
    "flags": "g",
    "ignoreCommentLines": false,
    "description": "A permission identifier ending in ':default' inside a Tauri capability file — a request for a plugin's whole default bundle rather than the commands this app calls. THE EXTENT IS NOT VISIBLE AT THE CALL SITE and is a property of the plugin version, not of this app: resolved against src-tauri/gen/schemas/acl-manifests.json on 2026-08-17, 'core:default' alone grants 92 commands (all 22 core:menu, all 12 core:tray, 28 core:window verbs, core:image:from_path, core:webview:internal_toggle_devtools) and is 92 of the 120 that capabilities/default.json grants in total. WHY THIS IS A DEFECT AND NOT STYLE, measured: 6 of default.json's 15 entries have a MARGINAL CONTRIBUTION OF ZERO — core:app:default and core:event:default are already inside core:default; the three notification:allow-* are already inside notification:default; core:window:allow-is-maximized is already inside core:default. The file reads as least privilege (five hand-picked core:window:allow-* verbs at the bottom) and is not, because line 10 already opened the door. A blanket grant SILENTLY VOIDS every narrow grant beside it. ignoreCommentLines is false deliberately: JSON has no comments, and the engine's comment heuristic keys on '//', '*' and '/*', none of which can begin a line in a well-formed capability file. THE COMPLIANT DOOR: a named command grant, '<ns>:allow-<command>' — see capabilities/default.json:20-24 (core:window:allow-minimize / allow-toggle-maximize / allow-close / allow-start-dragging) and the positive control below, which counts exactly that form. MEASURED 2026-08-17 at 9fdede67c: 13 matches across 2 files (default.json:10,11,12,13,17,18,19 = 7; mobile.json:7,8,9,10,14,15 = 6) against 11 matches for the compliant named form (default.json:14,15,16,20,21,22,23,24 = 8; mobile.json:11,12,13 = 3). ANCHOR ACCOUNTS EXACTLY: the two 'permissions' arrays hold 15 + 9 = 24 identifiers; 13 blanket + 11 named = 24, no residue, and the two populations are MUTUALLY EXCLUSIVE BY CONSTRUCTION since an id cannot end in both ':default' and ':allow-x'. PRECISION 13/13 hand-read against the manifest, every one resolving to a multi-command bundle (core 92, notification 16, updater 4, dialog 3, core:app 8, core:event 4, deep-link 1). NO EXCLUDE ENTRIES: neither file has a legitimate blanket grant, and an unexplained exemption is how an allowlist becomes a place violations hide. ROOTS ARE DELIBERATELY src-tauri/capabilities AND NOT src-tauri: a .json rule rooted at src-tauri also walks gen/android/**/tauri.conf.json and gen/schemas/*.json, which are gitignored build outputs whose presence varies by machine — the baseline would be machine-dependent and an exclude naming them would be a stale-exclude structural failure on a clean clone (see section 8 gap 4). LEGAL FIX: replace '<ns>:default' with the '<ns>:allow-<command>' entries the app calls, verified by resolving the file against gen/schemas/acl-manifests.json and checking each entry's marginal contribution is non-zero. DO NOT 'fix' a match by moving it into the other capability file. END OF LIFE: designed to reach zero. The runner fails structurally on zero matches BY DESIGN — DELETE this rule then, do not baseline it at 0. PRECONDITION (re-derive per repo, do NOT port): the stack-free condition is 'a grant naming a whole bundle instead of the operations performed'; in a browser extension that is '<all_urls>' in permissions, in AWS IAM it is \"Action\": \"s3:*\", in Kubernetes RBAC it is verbs: [\"*\"]. This regex scores ZERO on all three."
  },
  "baseline": { "files": 2, "matches": 13 },
  "floor": 2
}
```

**The positive control** — same anchor, pointed at the compliant form, no baseline:

```json
{
  "id": "blanket-default-permission-grant-positive-control",
  "goldenPath": "docs/concepts/golden-paths/tauri-permissions-and-csp.md",
  "title": "POSITIVE CONTROL — not a gate. The same permission-identifier anchor pointed at the named-command form the rule must never report.",
  "roots": ["src-tauri/capabilities"],
  "extensions": [".json"],
  "signal": {
    "pattern": "\"[a-z][a-z0-9-]*(?::[a-z0-9-]+)?:allow-[a-z0-9-]+\"",
    "flags": "g",
    "ignoreCommentLines": false,
    "description": "CONTROL: a permission identifier naming ONE command — the shape that asks for what it uses. THE TWO POPULATIONS PARTITION THE ANCHOR EXACTLY AND ARE MUTUALLY EXCLUSIVE BY CONSTRUCTION: an identifier cannot end in both ':default' and ':allow-<command>', and 13 + 11 = 24 = the total number of identifiers in the two 'permissions' arrays. Measured 2026-08-17 at 9fdede67c: 11 matches / 2 files — capabilities/default.json:14,15,16 (notification:allow-is-permission-granted / allow-request-permission / allow-notify) and :20,21,22,23,24 (core:window:allow-minimize / allow-toggle-maximize / allow-close / allow-is-maximized / allow-start-dragging); capabilities/mobile.json:11,12,13 (the three notification:allow-*). NOTE THE MEASUREMENT THIS CONTROL MAKES POSSIBLE: 7 of those 11 named grants have a MARGINAL CONTRIBUTION OF ZERO — 4 of default.json's 8 (the three notification:allow-* and core:window:allow-is-maximized) and 3 of mobile.json's 3 — because a ':default' entry above them already granted the command — which is precisely the harm the violating rule exists to ratchet, and it is only visible because both halves were counted. IF THIS EVER RETURNS ~0 the anchor has stopped discriminating on grant SHAPE and the rule's 13 are not what it thinks they are. It has NO baseline by design: it is expected to RISE as blanket grants are replaced with named ones, which is exactly why it must never ratchet.",
    "$measured": "2026-08-17 @ 9fdede67c via scripts/census/run-census.mjs in a private scratch registry (rules-tpc-tauri-permissions-csp-probe.json), fault-injected ten ways including one real violation appended to src-tauri/capabilities/default.json and reverted clean, then re-extracted from this finished document and re-run: identical."
  },
  "floor": 2
}
```

**Measured, in a private scratch registry, then re-extracted from this document and re-run — identical
both times:**

```
blanket-default-permission-grant                    2 files   13 matches   (base 2 / 13)   walked 2   floor 2
blanket-default-permission-grant-positive-control   2 files   11 matches   (no baseline)   walked 2   floor 2
census OK — 2 rule(s), 4 file-visits, 24 surviving violation(s) across 4 file(s).
```

**The anchor accounts exactly.** `default.json` declares 15 permission identifiers and `mobile.json`
declares 9: **24**. Violating 13 + compliant 11 = **24**. No residue, and the partition is
mutually exclusive by construction rather than by measurement.

**Precision, hand-audited against the ACL manifest, all 13: 13/13.** Every match resolves to a
multi-command bundle — `core` 92, `notification` 16, `updater` 4, `dialog` 3, `core:app` 8,
`core:event` 4, `deep-link` 1.

**Allowlist: empty, deliberately.** Neither file contains a blanket grant that is correct, and
`engine.mjs:276-288` makes an exemption that stops matching a structural failure — so an empty
`exclude` is also the only one that cannot go stale.

**How it fails loudly if its own precondition is absent — ten faults injected, every one fired**
(each exit code captured directly, never through a pipe):

| Induced fault | exit | what it printed |
|---|---:|---|
| **(unmodified)** | **0** | `OK blanket-default-permission-grant 2 2 13 13 2 2` · `OK …-positive-control 2 — 11 — 2 2` |
| pattern rewritten to match nothing | 1 | `[structural] matched zero files anywhere … DELETE the rule … rather than baselining it at zero` |
| `floor: 99999` | 1 | `walked 2 files but floor is 99999. THE MATCHER IS BROKEN, NOT THE CODEBASE CLEAN` |
| `roots: ["src-tauri/capabilities_DELETED"]` | 1 | `walked 0 files but floor is 2. THE MATCHER IS BROKEN…` |
| an `exclude` path that matches no file | 1 | `[structural] stale-exclude` |
| an `exclude` with its `reason` removed | 1 | schema rejection before the scan |
| baseline 1 low (a rise) | 1 | `[drift] matches rose 12 -> 13 (+1). New violations of docs/concepts/golden-paths/tauri-permissions-and-csp.md` |
| baseline 40 (a silent drop) | 1 | `[drift] matches dropped 40 -> 13 (-27) without the baseline moving. A silent drop is a broken matcher more often than fixed code` |
| a baseline added to the positive control | 1 | rejected — a control must not ratchet |
| **a REAL violation appended to `src-tauri/capabilities/default.json`** — a duplicate `"core:app:default"`, chosen so the *granted* set is provably unchanged (its marginal contribution is already 0) while the *counted* set rises by one | **1** | `FAIL … matches rose 13 -> 14 (+1)` — **reverted with `git checkout --`; `git status --porcelain` on that path empty; re-run returned to 2/13, exit 0** |

### 9.3 — What no gate can do

Three of this document's findings are absences and none is countable:

1. **That `devCsp` is not enforced** (§7.A). It is a fact about a `cfg` in a dependency, invisible to
   every static check over this repository. The complementary instrument: **an integration test that
   launches the app, reads `document.head`'s effective policy via the test-automation `/eval` route
   already on `:17320`, and asserts it against the config string.** It is the only instrument that can
   observe §0.4 and §0.4's hash-injection corollary at once, it needs the app running, and it is
   therefore out of bounds for this campaign.
2. **That the asset-protocol scope has outgrown its consumers** (§7.B). A rule could count
   `$APPDATA/**`-shaped entries, but the defect is the *relationship* between the scope and what is
   inside the directory at runtime — which changes without any file changing. The complementary
   instrument: a Rust test that lists `app_data_dir()` and fails if any entry outside the three
   feature subdirectories is `is_allowed()` by the configured scope. Cheap, runnable in CI, and the
   only shape that stays correct as new files are written.
3. **That a grant has no consumer** (§7.I). Requires joining `capabilities/*.json` against
   `acl-manifests.json` against every `invoke`/`@tauri-apps/api` import in 4,829 files. That is §9.1
   step 4's *warn* channel, not a census rule.

---

## 12. Corrections to the brief

The brief primed six leads. **Three survive, two are materially wrong, and one is right in spirit and
wrong in its central particular — in the direction that makes it much sharper.** Both spine labels
fail.

**1. `sides: "server"` is right, and this is the first time that field has been confirmed rather than
inverted.** Every headline defect is in `src-tauri/` — the CSP strings, the capability files, the
asset-protocol scope, `withGlobalTauri`, the ACL boundary. The client half is real but small: one
`document.createElement('script')` at `useYouTubePlayer.ts:61` and 16 `convertFileSrc` call sites, and
both are *consumers* of server-side grants rather than grants themselves. The §9 rule roots at
`src-tauri/capabilities`. **The corpus has now recorded `sides: "client"` contradicted on five leaves
and `sides: "both"` upheld once; this is the first `server` tested, and it holds.** Worth reporting as
loudly as a failure: the field's failure mode is specific to `"client"`, and this is a third data point
for that.

**2. `convergence: mixed` fails, and it fails in the two modes the doctrine warns are hardest to see at
once.** The measured cohort for this leaf is **1 of 5 independent siblings** — four have no WebView
shell at all, which is a *structural absence*, not a silence about the practice. Of the eight clauses
swept (§6), **seven are silences over a cohort of one** and the eighth is **the fleet converging on the
disease**: 3 of 3 policies outside this repo carry `'unsafe-inline' 'unsafe-eval'` in `script-src`,
including a Tauri v2 desktop app, while Personas' desktop `csp` carries neither. An oracle counting
agreement reads that as maximum confirmation of the opposite conclusion. **`mixed` implies a split
verdict across clauses with evidence on both sides; what is actually there is one contradicted clause
and seven measurements with no denominator.** The label is not merely wrong, it is a category that
cannot be reached from a cohort of one.

**3. "`npm run check:tauri-configs` exists — measure what it asserts and what it does not." Confirmed,
and the answer is the document's sharpest single fact.** It asserts seven things, all correct, all
well-reasoned (§0.7). It reads **3 of 5** config files and **1 of 3** authored CSP strings. **The only
`BANNED_CSP_TOKENS` hit in the repository is in the one config file it does not open.** Its `checkCsp`
never reads `devCsp`, and it never reads either capability file. Two further findings the brief did not
anticipate: it has **no fail-loud precondition of its own** (a rename makes it measure nothing and
pass), and it is **in no lefthook hook** — `lefthook.yml:58-64`'s own comment about `npm run check`
("which nothing runs automatically") applies to it verbatim.

**4. "Three tier bundles and two feature sets, and `tauri.android.conf.json` sets `beforeBuildCommand:
"npx vite build"` which runs 0 of 14 codegen tasks. Ask what else differs per config file, and whether
the CSP does." Confirmed with two corrections and one addition.**
- **The three tier bundles do not reach the Tauri layer at all.** `build:starter|team|builder` set
  `VITE_APP_TIER` for the *frontend* build; `tauri:build*` sets no tier. All three tiers, and the
  untiered `tauri build`, ship **one** CSP, **one** capability set and **one** `withGlobalTauri`.
- **The codegen number is 0 of 14 declared / 0 of 13 in `prebuild`** — the `TASKS` map has 14 keys and
  each preset runs 13 (`predev` omits `checksums`, `prebuild` omits `host-check`). And `npx vite build`
  also skips `tsc -b` and the direct `sync-system-skills.mjs` call that `npm run build` makes.
- **What else differs is bigger than the CSP.** §7.G: the Android config inherits `devCsp`,
  `withGlobalTauri`, `assetProtocol`, `bundle.resources` and `plugins.updater` — five security-relevant
  keys it never mentions. **And yes, the CSP differs, in the one direction that matters:**
  `'unsafe-eval'` in `script-src`, present in no desktop policy.
- **The lite/stable overlays are clean.** Both set only `build.features` and `bundle.targets`, exactly
  what `ALLOWED_OVERLAY_KEYS` permits. The overlay surface is small and stayed small.

**5. "`scripts/check-csp-hosts.mjs` is a gate this campaign added, wired into `npm run check`. Measure
whether the CSP it checks matches the CSP that ships in each config." — Confirmed for `csp`, and for
`devCsp` the answer is worse than a mismatch.** It reads both policies from `tauri.conf.json` and
neither from `tauri.android.conf.json`, so a fetch host is validated against 2 of 3 authored policies.
**But the `devCsp` half validates a policy that is never applied on this platform** (§7.A), so a
build-failing completeness check is enforcing an allowlist that governs nothing. The check is not
wrong; it is aspirational, and nothing anywhere says so. Its `isNonNetworkHost` correctly treats
`*.localhost` as non-network, which is why `asset.localhost` never surfaced as a fetch target — and
`asset.localhost` is §7.B's entire delivery mechanism.

**6. "116 HTTP routes on three loopback ports. A CSP that allows `http://localhost:*` in `connect-src`
makes every one reachable from any page the WebView loads. Measure the actual directive." — This is the
lead that is right in spirit and wrong in its central particular, twice over.**
- **The packaged `connect-src` contains no loopback host at all.** From a packaged build, the 116
  routes are unreachable by `fetch` from the renderer. That is a real, undocumented control.
- **`devCsp` does list `http://localhost:*` and `ws://localhost:*` — and is never applied on desktop.**
  So in dev the routes are reachable not because the policy allows it but because **there is no
  policy**. The brief's conclusion ("every one of them reachable") is correct for the mode the operator
  runs in, and every step of its reasoning is wrong.
- **A third particular, smaller and worth recording:** CSP source expressions match the *host string*.
  `http://localhost:*` does not match `http://127.0.0.1:17400/…`, which is the spelling all 8 of this
  repo's own address literals use ([`inbound-endpoint-surface`](./inbound-endpoint-surface.md) §0.4).
  Both spellings reach the same socket. Had `devCsp` been enforced, it would have blocked the app's own
  spelling and permitted the other.

**7. "`open` gained `shellexecute-on-windows` — a permission change with a runtime effect." Confirmed
unchanged at `9fdede67c`** (`src-tauri/Cargo.toml:187`, with 26 lines of reasoning at `:162-186`), and
recorded in the deferred-fixes applied table at `golden-path-deferred-fixes.md:1574`. Owned by
[`external-url-opening`](./external-url-opening.md); cited in §3 as the model for how a permission
change should be documented in a manifest, not re-derived. One observation from this leaf's angle: it
is a **Cargo feature**, so it is a fourth grant language in this repository alongside
`tauri.conf.json`, `capabilities/*.json` and `ipc_auth.rs`'s string lists — and it is the only one of
the four whose change is visible in a diff a reviewer will read.

**8. "The version constants disagree across `tauri.conf.json`, `package.json` and `Cargo.toml` in at
least one place. Check whether the config files agree with each other." — The premise is false and the
instruction found something better.** All three read **1.1.0** and agree exactly
(`tauri.conf.json:4`, `package.json` `version`, `Cargo.toml:18`). The `0.2.0` the brief remembered is
`test_automation.rs:939`, a hardcoded literal in a `/health` response body, already recorded by
[`inbound-endpoint-surface`](./inbound-endpoint-surface.md) §12.3. **Doing what the instruction said
anyway found a fourth version:** `src-tauri/gen/android/app/src/main/assets/tauri.conf.json` — the
merged config a real `tauri android` run produced and left on disk — reads **`0.1.6`**. It is
`.gitignore`d, regenerated by nothing, checked by nothing, and it is also the artifact that supplied
§7.G's entire merge analysis. **A stale generated config was simultaneously the answer to a question
the brief asked wrongly and the instrument that answered a question it asked correctly.**

**9. A correction to my own instrument, recorded because it nearly shipped.** My first extraction of
`generate_handler!` returned **1,591** registered commands; the second returned **1,585**. I could
have taken the larger number as the more complete extraction. The six-entry difference was `path`,
`lines`, `found`, `src`, `broken`, `declared` — **prose, not identifiers** — matched because the regex
anchored on `$` under the `m` flag and doc-comment text survives a naive line-comment stripper inside
attribute blocks. **The tell was not the number, which could legitimately move; it was that the extras
were English words.** Same family as the corpus's standing warning about `//`-strippers eating URLs:
a matcher that answers "does this text appear" instead of "is this a thing".

**10. A prediction of my own, disproved.** I expected this leaf's worst finding to be a CSP directive —
a missing `object-src`, a stray wildcard, `'unsafe-inline'` somewhere it mattered. The CSP is, by the
fleet's standard, **the best-written policy in six codebases**: 13 directives, `object-src 'none'`,
`base-uri 'self'`, `form-action 'self'`, no unsafe token in any script directive, while three of three
sibling policies carry both. **The two P0s are a policy that is never applied and a file-serving scope
that quietly grew to include the vault key.** Neither is a directive. Both are consequences of the same
thing: **the configuration is the only part of this system that nothing in the repository reads.**
