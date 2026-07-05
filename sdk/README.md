# Personas SDK (reference client)

A **zero-dependency, single-file** TypeScript client for the local Personas
management API (`127.0.0.1:9420`). Use it from a cloud web app (after pairing) or
from Node/CLI.

- Client: [`personas-sdk.ts`](./personas-sdk.ts)
- HTTP contract: [`../docs/api/management-api.openapi.yaml`](../docs/api/management-api.openapi.yaml)
- Design: [`../docs/architecture/cloud-integration-bridge.md`](../docs/architecture/cloud-integration-bridge.md)

## Browser (cloud app)

A browser origin must be **paired** by the user once. `pair()` drives that flow —
it raises an approval modal in the desktop app, then returns the minted key.

```ts
import { pair, PersonasClient } from "./personas-sdk";

// User approves in the desktop app; you get back an origin-bound, expiring key.
const token = await pair({
  scopes: ["personas:read", "personas:execute:persona:<id>"],
  name: "My Dashboard",
});

const client = new PersonasClient({ token });
const { data } = await client.listPersonas();
const result = await client.run("<persona-id>", { topic: "Rust async" }); // execute + poll
```

Store the returned `token` (e.g. `localStorage`) and reuse it until it expires;
re-run `pair()` to get a new one. The token only works from the origin you paired.

## Node / CLI

Create a key in the desktop app (Settings → API Keys). In Node there's no
automatic `Origin` header, so if the key is origin-bound, pass `origin`:

```ts
const client = new PersonasClient({ token: process.env.PERSONAS_KEY!, origin: "https://app.example" });
```

CLI/MCP keys are typically **not** origin-bound (created directly in Settings),
so `origin` is unnecessary for those.

## Notes

- Requires `globalThis.fetch` and `globalThis.crypto` (browsers; Node ≥ 18 for
  fetch, ≥ 19 for `crypto`, or pass `fetch` / polyfill `crypto`).
- Rate limit: 120 req / 60 s per key → the client throws `PersonasError(429)`.
- **Promotion:** this is a reference file, not yet a published package. Promoting
  it to `@personas/sdk` (with build + types + tests) is a tracked follow-up —
  copy this file until then.
