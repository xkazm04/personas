# Headless persona on Qwen — runbook (MCP driver tools)

New Personas MCP tools (in `mcp_server/tools.rs`) let you build + configure a
persona without the GUI, and a running persona post its own result to Messages:

- `personas_create { name, system_prompt, provider?, model?, description?, enabled? }`
  → creates the persona, returns its `id`. `model_profile` is written plaintext
  (no `auth_token` for Qwen → the engine reads it directly; encryption is a no-op
  without a secret).
- `personas_set_model { persona_id, provider, model? }` → sets `model_profile` to
  `{provider, model}`, e.g. `provider:"qwen"` routes its executions to the Qwen
  cloud engine (engine resolves the provider in `config_merge`).
- `post_message { content, title?, persona_id?, priority?, execution_id? }` → posts
  to the Messages module (`persona_messages`). This one IS remote-safe, so a
  running Qwen persona can post its own summary mid-run.

`personas_create` / `personas_set_model` are **driver-only** (not remote-safe —
a prompt-injected remote model can't create personas or change models).

## Scenario: "fetch last email → summarize → post to Messages", on Qwen

Phase A (verified by `driver_tool_tests::create_set_model_and_post_message`):
```
personas_create { name: "Gmail Summarizer",
  system_prompt: "Call gmail_get_message to read the most recent email, then
                  call post_message with a 2-sentence summary. Use the tools.",
  provider: "qwen", model: "qwen3-coder-plus" }
# (set_model is also available if you create first then switch the engine)
```

Phase B (live — runs against the running app/daemon, not `cargo test`):
1. **Enable connectors for Qwen:** set `qwen_connector_tools = "true"` (Settings,
   or `set_app_setting`). This both exposes `gmail_*` to the Qwen tool loop and —
   via the runner gate fix — makes connector-only personas enter the tool loop
   even without a `persona_tools` row.
2. **Ensure a Gmail credential** is connected (Settings → Connectors) and the
   Qwen API key is configured (Settings → BYOM → API Keys).
3. **Execute** the persona (`personas_execute` or the UI). The background daemon
   picks up the queued run; the engine routes to Qwen; Qwen calls
   `gmail_get_message` (executed locally via the :9420 credential proxy — the
   credential never leaves the machine), summarizes, and calls `post_message`.
4. **Observe** the summary in the Messages view.

> Why Phase B is live-only: the `:9420` credential proxy + Google OAuth creds +
> the daemon execution loop exist only in the running app, not in `cargo test`.
> The tool plumbing (create/set-model/post_message + routing + opt-in gate) is
> unit/compile-verified; the Gmail round-trip is verified in the running app.
>
> Data-residency: with the opt-in on, the email *content* (tool result) crosses
> to Qwen. Connector *credentials* stay local. Keep sensitive personas on Claude.
