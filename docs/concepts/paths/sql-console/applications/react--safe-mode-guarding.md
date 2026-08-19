---
layer: application
subject: sql-console
technique: safe-mode-guarding
stack: react
---

# The client mirror and the consent gate

The client side of the guard is two files under
`src/features/vault/sub_databases/`: `safeModeUtils.ts` (the mirror
classifier) and `hooks/useQuerySafeMode.ts` (the consent gate). Both editors
and the NL chat lane consume the hook, so there is one client-side gate for
three authors.

## The mirror

`safeModeUtils.ts:1-7` states its own status: *"Mirrors the Rust
`is_mutation()` logic so the UI can show instant feedback without an IPC
round-trip. The backend still enforces the guard — this is purely for the
confirmation dialog decision."* That is the advisory-mirror contract in the
code's own words.

`isMutationQuery` (`:37-68`) reproduces the authority's structure:

- leading `--` and `/* */` comments stripped first (`:41-53`), with an
  unclosed block comment returning `true` — fail-closed (`:48`);
- first keyword tested against `READ_ONLY_KEYWORDS` (`:9-18`);
- a `WITH`-led statement does not stop there: `stripSqlLiterals` (`:26-34`,
  dollar-quoted, single-quoted, double-quoted) runs before
  `MUTATION_VERBS_RE` scans the body (`:62-65`).

**Deviation, measured by the legacy corpus:** the client's CTE verb regex
(`:24`: DELETE|UPDATE|INSERT|MERGE|REPLACE|TRUNCATE|UPSERT) omits `DROP` and
`ALTER`, which the Rust list carries — so the two mirrors disagree on 2 of
47 fixture statements. The disagreement fails closed (the server refuses
what the client would have let through to a confirm dialog), so the cost is
UX, exactly the failure direction the technique says a mirror may have. The
structural fix the technique prescribes — one shared vocabulary — is
available and unused: `classify_db_query` (`src-tauri/src/commands/credentials/db_schema.rs:164`)
exposes the authoritative classifier over IPC with a typed wrapper at
`src/api/vault/database/dbSchema.ts:64` and has zero callers.

## The consent gate

`useQuerySafeMode` (`hooks/useQuerySafeMode.ts:21-79`) turns the mirror's
verdict into the gate:

```ts
// useQuerySafeMode.ts:24, :40-49
const [safeMode, setSafeMode] = useState(true);            // default ON
const guardedExecute = useCallback(async (queryText) => {
  if (safeMode && isMutationQuery(text)) {
    setPendingMutation(text);                               // hold, don't run
    pendingRunQueryRef.current = runQuery;
    return;
  }
  await runQuery(text, !safeMode);                          // allow_mutation follows the mode
}, [safeMode, runQuery]);
```

Confirming (`confirmMutation`, `:51-64`) re-issues the held text with
`allowMutation = true`; the server then re-classifies and permits it. The
mirror decided whether to *ask*; the authority decides whether to *run*.

**Consent bound to its target:** the held statement is pinned to the
`runQuery` identity in effect when it was stashed (`:31`, `pendingRunQueryRef`);
an effect (`:33-38`) and a belt-and-braces check inside `confirmMutation`
(`:55-59`) void the pending mutation if the parent swaps `runQuery` —
which callers memoize on the `(credentialId, queryId)` tuple, per the
docstring at `:13-19`. The user cannot accept a destructive confirm whose
underlying connection changed underneath them.

## The banner, and its measured deviation

`tabs/MutationConfirmBanner.tsx` renders the held statement in a `<pre>`
with the run/cancel pair. **Deviation:** `:41` slices the statement at 200
characters (`pendingMutation.slice(0, 200) + '...'`) inside a `max-h-20`
container — consent to a prefix, in the one mode (write mode) where the
server's batch refusal is skipped and a pass-through connector forwards the
tail verbatim. The technique's rule is scroll, never slice.

## Three authors, one hook

`tabs/ConsoleTab.tsx:37`, `tabs/QueryEditorPane.tsx:73`, and the NL lane
`tabs/ChatTab.tsx:177` each call `useQuerySafeMode(runQuery)`; the chat
lane's comment at `:180-181` says why: *"AI-suggested mutations get the same
confirm dialog as the SQL editor, driven by the shared useQuerySafeMode
hook (safe mode on by default)."* The consent gate is one component, so a
hardening lands in all three lanes at once.
