# Connector knowledge (Personas Vault)

The Personas app manages the user's service credentials in its **Vault**
(catalog UI: `src/features/vault/sub_catalog`, credentials:
`src/features/vault/sub_credentials`; the service-type registry is
`src/lib/connectors/connectorMeta.tsx`). This skill only ever handles
connector **metadata** — `{name, service_type}` — supplied by the dispatch
context block or by asking the user. Credential VALUES stay in the Vault and
reach code exclusively as environment variables the user sets per deployment.

## Service types by passport dimension

| Dimension | Catalog service types (choose by stack fit) |
|---|---|
| Hosting | `vercel`, `netlify`, `cloudflare`, `fly_io`, `railway`, `digitalocean`, `aws`, `firebase`, `kubernetes` |
| Database | `supabase`, `neon`, `postgres_proxy` (any PostgreSQL), `convex`, `upstash` (Redis), `firebase` |
| Auth | `supabase`, `firebase`, plus code-level libs the probe detects (Clerk, Auth.js, Auth0, Better Auth, Lucia, WorkOS, Stytch, Kinde) — a code lib needs no Vault connector, only env vars |
| CI / VCS | `github`, `gitlab`, `azure_devops`, `circleci` |
| Observability (errors/logs/metrics/tracing) | `sentry`, `datadog`, `betterstack`, `pagerduty`, `uptime_robot` |
| LLM tracking | `langfuse`, `helicone`, `langsmith`, `tracklight` (LightTrack) |
| Analytics (occasionally offered under observability) | `posthog`, `mixpanel`, `amplitude`, `segment` |

## The offer flow

1. **An existing connector fits** (context block lists a matching
   service_type): offer it BY NAME — "Wire *my-sentry* (Sentry) into test +
   production". This is almost always the recommended option; the user already
   trusts that service.
2. **No existing connector fits**: offer "Add a <type> connector in Personas →
   Vault first, then wire it". The wiring work can still proceed in the same
   run — code reads env var names that the user fills after creating the
   credential. Say exactly which env vars they will need to set and where.
3. **Standalone mode** (no context block): ask — "Which monitoring service do
   you use?" with the catalog's realistic candidates as options + Other.

## What "binding" means on the Personas side

The wall binds credentials to a project on three slots of `dev_projects`:
`monitoring_credential_id` (lights errors/logs/metrics/tracing),
`llm_tracking_credential_id`, and `pr_credential_id` (CI/auto-PR). When
dispatched by the wall, mention in the final report which slots the user
should bind in the wall's cell popovers — the skill wires CODE; the wall
binds CONNECTORS; the passport goes green when both sides meet.

## Env-var naming conventions (wiring)

Use the service's canonical names — never invent novel ones:
`SENTRY_DSN`, `DATADOG_API_KEY`, `LOGTAIL_SOURCE_TOKEN` (Better Stack),
`LANGFUSE_PUBLIC_KEY`/`LANGFUSE_SECRET_KEY`/`LANGFUSE_HOST`,
`HELICONE_API_KEY`, `LANGCHAIN_API_KEY` (LangSmith), `DATABASE_URL`
(postgres/neon/supabase), `SUPABASE_URL`/`SUPABASE_ANON_KEY`,
`UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN`, `VERCEL_TOKEN` (CI
deploy). Per environment, the NAME stays the same — the VALUE differs per
deployment target; document that in `.env.example` comments
(`# set per environment: local .env / CI secrets / host dashboard`).
