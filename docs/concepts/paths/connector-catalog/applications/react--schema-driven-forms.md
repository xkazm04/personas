---
layer: application
subject: connector-catalog
technique: schema-driven-forms
stack: react
---

# Schema-driven credential forms in the vault catalog

The repo runs the technique on two lanes with one field vocabulary. **Shipped
connectors** declare their credential shape in per-connector JSON
(`scripts/connectors/builtin/slack.json`: two `fields` entries with `key`,
`label`, `type: "password"`, `required`, `placeholder`, `helpText`, and
`sensitive: true` at `:19`/`:28`), rendered by `CredentialTemplateForm`.
**Operator-defined connectors** (MCP servers, custom APIs, databases) go
through `CredentialSchemaForm`
(`src/features/vault/sub_catalog/components/schemas/CredentialSchemaForm.tsx`),
driven by a `SchemaFormConfig` whose factories live in
`schemaConfigs.tsx` — `getMcpSchema` (`:13`), `getCustomSchema` (`:85`),
`getDatabaseSchema` (`:173`). Each config is sub-typed (`config.subTypes`,
selected at `CredentialSchemaForm.tsx:80`), and each sub-type carries its own
field list plus a `healthcheck(fieldValues)` recipe builder (`:96-105`) — the
declaration feeding both the form and the probe, exactly the alignment the
technique demands.

## Declaration → renderer specifics worth copying

- **Extra-field kinds are a closed widget vocabulary** (`textarea`,
  `checkbox`, `key-value-list`), initialized per kind (`:47-53`) and rendered
  by a single `ExtraFieldRenderer` — a new kind benefits every config.
- **Key-value rows get minted ids on entry** (`:55-67`): pairs arriving from
  edit flows may lack one, and the renderer keys rows by id because "index
  keys mis-attach row state after a delete" — identity-survives-reuse applied
  at the widget level, with the reason in the comment.
- **The save path serializes the declared shape, not the rendered one**
  (`:121-125`): the connector row's `fields` column is built from the
  sub-type's declaration, so storage and any later re-render read the same
  contract the form did.

## The paired mint and its reaper

For operator-defined connectors, save creates a catalog row *and* the first
credential as one act (`createConnectorDefinition` at `:135-146`, then
`createCredential` at `:153-158`). The failure seam is closed: if the
credential save throws after the row was minted, the catch deletes the
just-created connector (`:168-177`), and because the rollback is itself
fallible, its failure goes to a breadcrumb rather than vanishing — the
comment names the stake: "an orphaned connector after a save failure isn't
invisible."

## The gate, and the measured vacuous green

Save is hard-gated on probe success: `CredentialTemplateForm.tsx:187-193`
disables Save until `healthcheckResult?.success` (plus the OAuth-completion
arm for OAuth templates). That makes probe/declaration alignment
load-bearing — and the misalignment is measured, not hypothetical:
`docs/concepts/golden-path-deferred-fixes.md` §126 found that of 113 shipped
connectors carrying a `healthcheck_config`, three declare an `api_key` field
their probe never substitutes (no `{{field}}`, no auth header), so "Test
connection" returns green **for any typed value** — and the gate then admits
exactly those credentials. The healthy contrast is in the same population:
`slack.json:31-38` substitutes `{{bot_token}}` into an `auth.test` call, and
the one connector declaring zero fields (`arxiv`) is *correctly*
unauthenticated rather than vacuously green. The durable fix the register
names — a seed-time cross-check of the (declared fields, probe template)
pair — is the technique's intra-row consistency rule verbatim.

## Where the repo deviates from the standard

- The per-connector escape hatch is partially structural: sub-types,
  variants, and auth methods (`CredentialTemplateForm.tsx:150-162`) are
  declarative, but MCP/custom/database get whole distinct config factories
  rather than registered overrides on one registry — enumerable in practice
  (three factories), but growth would push toward the technique's registry
  shape.
- Validation lives at the form layer; the storage door
  (`createCredential`) does not re-enforce required/format rules, so
  non-form writers (import, automation) bypass the declared contract — the
  technique's "three more readers" section names this as the gap it is.
