# Athena Browser Bridge (extension)

MV3 Chrome extension that pairs this browser with the Personas desktop app's
`/browser-bridge` so Athena can run approved live tests of your web apps here.
The extension only ever drives tabs it opens itself; the desktop app enforces
the approved test origin server-side.

## Load (dev)

1. chrome://extensions → Developer mode → **Load unpacked** → this folder.
2. Open the extension's **Options** and paste the app's bridge **port**
   (default 17400 — see the app log line `local_http listening port=…`) and
   the **pairing token**.
3. The action badge shows a green dot while connected.

## Automated QA

Harnesses can skip the options page by dropping a `config.json` next to the
manifest (`{"port": 17400, "token": "..."}`) before loading the extension —
storage-saved options always win over the packaged file. Pair it with
`PERSONAS_BROWSER_BRIDGE_TOKEN` on the app process.

`config.json` is gitignored — it carries a live pairing secret; never commit one.

## Protocol

Frames mirror `src-tauri/src/browser_bridge/relay.rs`; the mock twin used by
bridge-level QA is `scripts/test/browser-bridge-mock-extension.mjs`.
