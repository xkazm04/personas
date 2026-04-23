# Live Roadmap — publishing

This folder holds the **initial payload** that bootstraps the Live Roadmap feature described in [`../live-roadmap.md`](../live-roadmap.md).

## What to publish

Copy [`v1.json`](./v1.json) to `personas-web` at:

```
personas-web/public/roadmap/v1.json
```

Commit + deploy `personas-web` as you normally would. Once it's live, the desktop app (any build that ships `fetch_roadmap`) will GET `https://personas.so/roadmap/v1.json` on launch and override the bundled roadmap content with this file's contents.

## Verifying after deploy

```bash
curl -I https://personas.so/roadmap/v1.json
```

Expect `HTTP/2 200` and a `content-type: application/json` header. If you get `404`, the `public/` file wasn't copied into the build — check your `personas-web` deployment pipeline.

## Updating the roadmap

1. Edit `personas-web/public/roadmap/v1.json` directly — titles, descriptions, statuses, add/remove items.
2. `git commit` + push.
3. Wait for the `personas-web` deploy (usually 30 s – 2 min).
4. Desktop users see the change on next app launch, or immediately if they hit the Refresh pill in the Roadmap view.

### Rules of the road

- **Never reuse an item id** after removing it — if you drop item `2` and later want something different for `2`, pick a new id instead. Prevents stale desktop caches from showing wrong content under that id.
- **`schemaVersion` MUST stay `1`.** Bumping it will cause every currently-shipped desktop build to fall back to bundled content. If the schema ever needs to change incompatibly, publish `v2.json` at a new path and roll out a desktop build that fetches `v2.json` first.
- **`release.version` MUST stay `"roadmap"`.** The desktop client rejects payloads with any other value. This field exists to mirror the on-disk `releases.json` structure, not to name the release.
- **`i18n.en` is required.** Missing locales fall back to English. You can add any of: `en`, `zh`, `ar`, `hi`, `ru`, `id`, `es`, `fr`, `bn`, `ja`, `vi`, `de`, `ko`, `cs`.
- **Unknown top-level keys are ignored** by the desktop client (forward-compatible). Fine to add things future builds will use.
- **Unknown `status` or `priority` values** on an item are normalised to `planned` / `later` on the desktop side. New values become real only after a desktop release that understands them.

## Rolling back a bad publish

Revert the commit in `personas-web` and redeploy. Users whose cache still holds the bad payload will pick up the reverted version on next refresh (<= 1 h by default, immediately via the Refresh pill).

If the payload is so malformed that the desktop client rejects it (schema validation failure), no action is needed — those clients already fell back silently to bundled content and will pick up the good payload automatically once redeployed.
