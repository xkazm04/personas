---
layer: application
subject: embedded-preview
technique: origin-validation
stack: react
---

# Origin discipline on the Studio bridge — absent on both sides, measured

The technique's rule is symmetric: verify inbound `origin`, never send to
`'*'`. The Studio bridge does neither, in either direction. This
application exists to make the gap precise, because the bridge is
otherwise well-shaped and the omission is easy to miss.

## Inbound, host side — `src/features/studio/StudioPage.tsx:114-142`

The single `message` listener (`:116`) dispatches on shape only:

```ts
if (!d || d.source !== 'athena-agent') return;
```

`e.origin` is never read anywhere in the file. Any document able to post
to the Studio window with `{source:'athena-agent', type:'located', rect}`
moves the orb pointer; with `{type:'route', path}` it rewrites the
address bar for whichever tab's frame it can impersonate — and since
`route` attribution matches `e.source` against mounted frames
(`:133-136`), a document *inside* one of those frames (the guest's own
code, a nested frame the guest embedded, the page a redirect landed on)
qualifies. Today the verbs are cosmetic (a ring, an address bar), so
the blast radius is small — the reason to fix it now is that the next
verb added to this listener inherits the missing check.

## Outbound, host side — `StudioPage.tsx:155-158`

```ts
iframe?.contentWindow?.postMessage({ source: 'athena', type: 'locate', selector, reqId }, '*');
```

Wildcard target. The payload is a CSS selector — low sensitivity — but
the frame's URL is a `src` the user can edit via the address bar
(`:206-211`, "type any path"), and a guest can navigate itself anywhere;
after either, `'*'` delivers Studio's message to whatever loaded. The
expected origin is *available* at this call site — it is
`previewUrls[activeId]` (`:76-85`), minted from the registry's
`DevServerStatus.url` — so the fix is a one-argument change plus the
same value used for the inbound check.

## Both directions, guest side — `src-tauri/src/webbuild/preview_agent.rs:49-64,79-83`

The agent's listener filters `d.source !== "athena"` and never reads
`e.origin` (`:53`); both of its sends target `"*"` (`:63`, `:82`). The
technique notes the guest's copy of the expected origin must be injected
configuration, not learned over the channel — the agent has no
configuration channel at all today. The host's origin is the app's
webview origin, which the agent could be told at injection time
(`ensure()` writes the file verbatim, `:127-129`; a template substitution
would carry it).

## The rebind moment

The one place the technique's *rebind* rule would bite is handled
structurally: warm previews are keyed `\`${id}-${nonce}\`` (`:234`) so a
reload is a remount, and the URL is read from store state on each render.
No stale-origin window exists — because no origin is checked. When the
check is added, `previewUrls` is already the current truth to bind
against.

## Standing

Reported as a deviation of the golden path; the standard is kept. The
fix is mechanical and local: read `new URL(previewUrls[id]).origin`, use
it as the second argument of every `postMessage`, and compare `e.origin`
against the set of live preview origins in the inbound handler
(rejecting and counting the rest). Neither the protocol nor the agent
needs to change shape.
